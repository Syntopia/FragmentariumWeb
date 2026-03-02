mod frame_selection;
mod native_backend;
mod schema;

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use anyhow::Context;
use clap::Parser;
use frame_selection::select_frame_indices;
use native_backend::render_task_with_native_backend;
use schema::{NativeRenderManifest, RenderTask};
use serde_json::{Map, Value};

#[derive(Debug, Parser)]
#[command(name = "frag-render")]
#[command(about = "Headless native renderer for Fragmentarium Web animation manifests")]
struct Cli {
    #[arg(
        value_name = "MANIFEST_JSON",
        required_unless_present = "internal_task_json"
    )]
    manifest_json: Option<PathBuf>,

    #[arg(long)]
    output_dir: Option<PathBuf>,

    #[arg(
        long,
        value_name = "SPEC",
        help = "Frame selection: all | N | A-B | A-B:S | comma lists (e.g. 0,5,10-20,30-90:3)"
    )]
    frames: Option<String>,

    #[arg(
        long,
        value_name = "N",
        help = "Override maxSubframes for all selected frames"
    )]
    subframes: Option<u32>,

    #[arg(
        long,
        value_name = "PX",
        help = "Override output width. If --height is omitted, it is derived from manifest aspect ratio"
    )]
    width: Option<u32>,

    #[arg(
        long,
        value_name = "PX",
        help = "Override output height. If --width is omitted, it is derived from manifest aspect ratio"
    )]
    height: Option<u32>,

    #[arg(long, default_value = "auto")]
    gpu_profile: String,

    #[arg(
        long,
        help = "Always render and overwrite output files (default: skip already-rendered images)"
    )]
    force: bool,

    #[arg(long, hide = true)]
    internal_task_json: Option<PathBuf>,
}

fn load_native_manifest(path: &Path) -> anyhow::Result<NativeRenderManifest> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("Failed to read manifest JSON: {}", path.display()))?;
    let manifest: NativeRenderManifest = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid JSON in {}", path.display()))?;
    manifest.validate()?;
    Ok(manifest)
}

fn resolve_output_dir(manifest_path: &Path, override_dir: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = override_dir {
        return dir;
    }
    let parent = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = manifest_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("render");
    parent.join(format!("{stem}-frames"))
}

fn rebase_task_outputs(tasks: &[RenderTask], output_dir: &Path) -> anyhow::Result<Vec<RenderTask>> {
    let mut out = Vec::with_capacity(tasks.len());
    for task in tasks {
        let raw_path = PathBuf::from(&task.output_path);
        let rel_path = if raw_path.is_absolute() {
            let file_name = raw_path.file_name().ok_or_else(|| {
                anyhow::anyhow!(
                    "Absolute task output path has no filename component: '{}'",
                    task.output_path
                )
            })?;
            PathBuf::from(file_name)
        } else {
            raw_path
        };
        let rebased = output_dir.join(rel_path);
        let mut next_task = task.clone();
        next_task.output_path = rebased.to_string_lossy().to_string();
        out.push(next_task);
    }
    Ok(out)
}

fn read_positive_u32(obj: &Map<String, Value>, key: &str) -> anyhow::Result<u32> {
    let value = obj
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow::anyhow!("nativeBackend.{} is missing or not an integer", key))?;
    let converted = u32::try_from(value)
        .map_err(|_| anyhow::anyhow!("nativeBackend.{} is out of u32 range", key))?;
    if converted == 0 {
        anyhow::bail!("nativeBackend.{} must be > 0", key);
    }
    Ok(converted)
}

fn update_resolution_uniform(
    native_backend_obj: &mut Map<String, Value>,
    width: u32,
    height: u32,
) -> anyhow::Result<()> {
    let uniforms = native_backend_obj
        .get_mut("sceneUniforms")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| anyhow::anyhow!("nativeBackend.sceneUniforms is missing or not an array"))?;
    let mut updated = false;
    for uniform in uniforms {
        let uniform_obj = uniform
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("sceneUniforms entry is not an object"))?;
        let name = uniform_obj.get("name").and_then(Value::as_str);
        if name == Some("uResolution") {
            uniform_obj.insert(
                "value".to_owned(),
                Value::Array(vec![Value::from(width), Value::from(height)]),
            );
            updated = true;
        }
    }
    if !updated {
        anyhow::bail!("nativeBackend.sceneUniforms does not contain uResolution");
    }
    Ok(())
}

fn apply_task_overrides(
    task: &mut RenderTask,
    width_override: Option<u32>,
    height_override: Option<u32>,
    subframes_override: Option<u32>,
) -> anyhow::Result<()> {
    if let Some(subframes) = subframes_override {
        if subframes == 0 {
            anyhow::bail!("--subframes must be > 0");
        }
    }
    if let Some(width) = width_override {
        if width == 0 {
            anyhow::bail!("--width must be > 0");
        }
    }
    if let Some(height) = height_override {
        if height == 0 {
            anyhow::bail!("--height must be > 0");
        }
    }

    let snapshot_obj = task
        .snapshot
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Task snapshot must be an object"))?;
    let native_backend_obj = snapshot_obj
        .get_mut("nativeBackend")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| anyhow::anyhow!("Task snapshot.nativeBackend must be an object"))?;

    let current_width = read_positive_u32(native_backend_obj, "width")?;
    let current_height = read_positive_u32(native_backend_obj, "height")?;
    let (width, height) = resolve_target_resolution(
        current_width,
        current_height,
        width_override,
        height_override,
    )?;

    native_backend_obj.insert("width".to_owned(), Value::from(width));
    native_backend_obj.insert("height".to_owned(), Value::from(height));
    if let Some(subframes) = subframes_override {
        native_backend_obj.insert("maxSubframes".to_owned(), Value::from(subframes));
    }
    update_resolution_uniform(native_backend_obj, width, height)?;
    Ok(())
}

fn output_image_exists(path: &Path) -> anyhow::Result<bool> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file() && metadata.len() > 0),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(anyhow::anyhow!(
            "Failed to inspect output path '{}': {}",
            path.display(),
            error
        )),
    }
}

fn should_render_output(force: bool, output_exists: bool) -> bool {
    force || !output_exists
}

fn render_task_via_subprocess(
    task: &RenderTask,
    gpu_profile: &str,
    temp_task_dir: &Path,
) -> anyhow::Result<f64> {
    fs::create_dir_all(temp_task_dir).with_context(|| {
        format!(
            "Failed to create internal task directory '{}'",
            temp_task_dir.display()
        )
    })?;
    let task_json_path = temp_task_dir.join(format!("task_{:05}.json", task.frame_index));
    let task_json = serde_json::to_vec_pretty(task).context("Failed to serialize task JSON")?;
    fs::write(&task_json_path, task_json).with_context(|| {
        format!(
            "Failed to write internal task JSON '{}'",
            task_json_path.display()
        )
    })?;

    let exe = std::env::current_exe().context("Failed to resolve current executable path")?;
    let child_start = Instant::now();
    let status = Command::new(exe)
        .arg("--internal-task-json")
        .arg(&task_json_path)
        .arg("--gpu-profile")
        .arg(gpu_profile)
        .status()
        .context("Failed to spawn internal per-frame render subprocess")?;
    let elapsed_ms = child_start.elapsed().as_secs_f64() * 1000.0;

    if !status.success() {
        if status.code().is_none() {
            anyhow::bail!(
                "Native render subprocess for frame {} terminated by signal (likely GPU/driver crash). task_json='{}' output='{}'",
                task.frame_index,
                task_json_path.display(),
                task.output_path
            );
        }
        let code = status.code().unwrap_or(-1);
        anyhow::bail!(
            "Native render subprocess for frame {} exited with status {}. task_json='{}' output='{}'",
            task.frame_index,
            code,
            task_json_path.display(),
            task.output_path
        );
    }
    Ok(elapsed_ms)
}

fn compute_eta_seconds(
    rendered_done: usize,
    total_to_render: usize,
    sum_render_ms: f64,
) -> Option<f64> {
    if total_to_render == 0 {
        return Some(0.0);
    }
    if rendered_done == 0 {
        return None;
    }
    let remaining = total_to_render.saturating_sub(rendered_done);
    let avg_render_ms = sum_render_ms / (rendered_done as f64);
    Some((avg_render_ms * (remaining as f64)) / 1000.0)
}

fn resolve_target_resolution(
    current_width: u32,
    current_height: u32,
    width_override: Option<u32>,
    height_override: Option<u32>,
) -> anyhow::Result<(u32, u32)> {
    if current_width == 0 || current_height == 0 {
        anyhow::bail!(
            "Manifest has invalid resolution {}x{}",
            current_width,
            current_height
        );
    }
    match (width_override, height_override) {
        (Some(width), Some(height)) => {
            if width == 0 || height == 0 {
                anyhow::bail!("--width and --height must be > 0");
            }
            Ok((width, height))
        }
        (Some(width), None) => {
            if width == 0 {
                anyhow::bail!("--width must be > 0");
            }
            let ratio = current_height as f64 / current_width as f64;
            let resolved_height = ((width as f64) * ratio).round().max(1.0);
            Ok((width, resolved_height as u32))
        }
        (None, Some(height)) => {
            if height == 0 {
                anyhow::bail!("--height must be > 0");
            }
            let ratio = current_width as f64 / current_height as f64;
            let resolved_width = ((height as f64) * ratio).round().max(1.0);
            Ok((resolved_width as u32, height))
        }
        (None, None) => Ok((current_width, current_height)),
    }
}

fn format_duration(seconds: f64) -> String {
    let clamped = seconds.max(0.0);
    if clamped < 60.0 {
        return format!("{clamped:.1}s");
    }
    let total = clamped.round() as u64;
    let mins = total / 60;
    let secs = total % 60;
    if mins < 60 {
        return format!("{mins:02}m{secs:02}s");
    }
    let hours = mins / 60;
    let rem_mins = mins % 60;
    format!("{hours:02}h{rem_mins:02}m{secs:02}s")
}

fn format_eta(seconds: Option<f64>) -> String {
    match seconds {
        Some(value) => format_duration(value),
        None => "n/a".to_owned(),
    }
}

fn run_internal_task(task_json_path: &Path, gpu_profile: &str) -> anyhow::Result<()> {
    let raw = fs::read_to_string(task_json_path)
        .with_context(|| format!("Failed to read task JSON '{}'", task_json_path.display()))?;
    let task: RenderTask = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid task JSON in '{}'", task_json_path.display()))?;
    let _report = render_task_with_native_backend(&task, gpu_profile)?;
    Ok(())
}

fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if let Some(task_json_path) = cli.internal_task_json.as_deref() {
        return run_internal_task(task_json_path, &cli.gpu_profile);
    }

    let manifest_path = cli
        .manifest_json
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("MANIFEST_JSON is required"))?;

    let manifest = load_native_manifest(manifest_path)?;
    let expanded_tasks = manifest.expand_tasks()?;
    if expanded_tasks.is_empty() {
        anyhow::bail!("Manifest contains no render tasks");
    }

    let selected_indices = select_frame_indices(cli.frames.as_deref(), expanded_tasks.len())?;
    let selected_tasks: Vec<RenderTask> = selected_indices
        .iter()
        .map(|index| expanded_tasks[*index].clone())
        .collect();
    if selected_tasks.is_empty() {
        anyhow::bail!("No frames selected for rendering");
    }

    let output_dir = resolve_output_dir(manifest_path, cli.output_dir);
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("Failed to create output directory {}", output_dir.display()))?;
    let mut tasks = rebase_task_outputs(&selected_tasks, &output_dir)?;
    for task in &mut tasks {
        apply_task_overrides(task, cli.width, cli.height, cli.subframes)?;
    }
    let task_temp_dir = output_dir.join(".frag-render-tasks");

    let mut render_flags = Vec::with_capacity(tasks.len());
    let mut preexisting_count = 0usize;
    for task in &tasks {
        let exists = output_image_exists(Path::new(&task.output_path))?;
        let should_render = should_render_output(cli.force, exists);
        if !should_render {
            preexisting_count += 1;
        }
        render_flags.push(should_render);
    }
    let total_to_render = render_flags.iter().filter(|flag| **flag).count();

    eprintln!(
        "[frag-render] start manifest='{}' selected_frames={} output_dir='{}' gpu_profile={} force={} overrides width={:?} height={:?} subframes={:?} to_render={} skip_existing={}",
        manifest_path.display(),
        tasks.len(),
        output_dir.display(),
        cli.gpu_profile,
        cli.force,
        cli.width,
        cli.height,
        cli.subframes,
        total_to_render,
        preexisting_count
    );

    if total_to_render == 0 {
        eprintln!(
            "[frag-render] done frames={} rendered=0 skipped={} total=0.000ms mean/frame=0.000ms min/frame=0.000ms max/frame=0.000ms output_dir='{}'",
            tasks.len(),
            tasks.len(),
            output_dir.display()
        );
        return Ok(());
    }

    let start = Instant::now();
    let mut min_ms = f64::INFINITY;
    let mut max_ms = 0.0_f64;
    let mut sum_ms = 0.0_f64;
    let mut rendered_done = 0usize;
    let mut skipped_done = 0usize;

    for (position, task) in tasks.iter().enumerate() {
        let ordinal = position + 1;
        if !render_flags[position] {
            skipped_done += 1;
            let elapsed = start.elapsed().as_secs_f64();
            let percent = (ordinal as f64 * 100.0) / (tasks.len() as f64);
            let eta = compute_eta_seconds(rendered_done, total_to_render, sum_ms);
            eprintln!(
                "[frag-render] skip {}/{} source_frame={} (output exists) -> {}",
                ordinal,
                tasks.len(),
                task.frame_index,
                task.output_path
            );
            eprintln!(
                "[frag-render] progress {}/{} ({:.1}%) elapsed={} eta={} rendered={} skipped={}",
                ordinal,
                tasks.len(),
                percent,
                format_duration(elapsed),
                format_eta(eta),
                rendered_done,
                skipped_done
            );
            continue;
        }
        eprintln!(
            "[frag-render] frame {}/{} source_frame={} -> {}",
            ordinal,
            tasks.len(),
            task.frame_index,
            task.output_path
        );
        let report_total_ms = render_task_via_subprocess(task, &cli.gpu_profile, &task_temp_dir)
            .with_context(|| {
                format!(
                    "Rendering failed for selected frame {} (source frame {})",
                    ordinal, task.frame_index
                )
            })?;
        rendered_done += 1;
        min_ms = min_ms.min(report_total_ms);
        max_ms = max_ms.max(report_total_ms);
        sum_ms += report_total_ms;

        let elapsed = start.elapsed().as_secs_f64();
        let percent = (ordinal as f64 * 100.0) / (tasks.len() as f64);
        let eta = compute_eta_seconds(rendered_done, total_to_render, sum_ms);
        eprintln!(
            "[frag-render] progress {}/{} ({:.1}%) elapsed={} eta={} last={:.3}ms rendered={} skipped={}",
            ordinal,
            tasks.len(),
            percent,
            format_duration(elapsed),
            format_eta(eta),
            report_total_ms,
            rendered_done,
            skipped_done
        );
    }

    let total_elapsed = start.elapsed().as_secs_f64() * 1000.0;
    let rendered_count = rendered_done;
    let mean_ms = if rendered_count > 0 {
        sum_ms / (rendered_count as f64)
    } else {
        0.0
    };
    let min_ms = if rendered_count > 0 { min_ms } else { 0.0 };
    let max_ms = if rendered_count > 0 { max_ms } else { 0.0 };
    eprintln!(
        "[frag-render] done frames={} rendered={} skipped={} total={:.3}ms mean/frame={:.3}ms min/frame={:.3}ms max/frame={:.3}ms output_dir='{}'",
        tasks.len(),
        rendered_count,
        skipped_done,
        total_elapsed,
        mean_ms,
        min_ms,
        max_ms,
        output_dir.display()
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[frag-render] ERROR: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{compute_eta_seconds, resolve_target_resolution, should_render_output};

    #[test]
    fn infers_height_from_width_override() {
        let (width, height) = resolve_target_resolution(1052, 591, Some(2104), None)
            .expect("width-only override should resolve");
        assert_eq!(width, 2104);
        assert_eq!(height, 1182);
    }

    #[test]
    fn infers_width_from_height_override() {
        let (width, height) = resolve_target_resolution(1052, 591, None, Some(1182))
            .expect("height-only override should resolve");
        assert_eq!(width, 2104);
        assert_eq!(height, 1182);
    }

    #[test]
    fn keeps_original_resolution_without_overrides() {
        let (width, height) = resolve_target_resolution(1052, 591, None, None)
            .expect("no override should keep original resolution");
        assert_eq!(width, 1052);
        assert_eq!(height, 591);
    }

    #[test]
    fn skip_logic_prefers_resume_by_default() {
        assert!(should_render_output(false, false));
        assert!(!should_render_output(false, true));
        assert!(should_render_output(true, true));
    }

    #[test]
    fn eta_uses_only_remaining_render_frames() {
        let eta = compute_eta_seconds(2, 5, 3000.0).expect("eta should be available");
        assert!((eta - 4.5).abs() < 1.0e-6);
    }

    #[test]
    fn eta_unknown_before_first_render_when_work_remains() {
        assert_eq!(compute_eta_seconds(0, 3, 0.0), None);
    }

    #[test]
    fn eta_zero_when_no_render_work() {
        assert_eq!(compute_eta_seconds(0, 0, 0.0), Some(0.0));
    }
}
