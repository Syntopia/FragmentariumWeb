use serde::Deserialize;
use serde_json::{Map, Value};

const NATIVE_RENDER_MANIFEST_V1_FORMAT: &str = "fragmentarium-web-animation-render-manifest-v1";
const NATIVE_RENDER_MANIFEST_V2_FORMAT: &str = "fragmentarium-web-animation-render-manifest-v2";

#[derive(Debug, serde::Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderTask {
    pub frame_index: usize,
    pub frame_count: usize,
    pub timeline_t: f64,
    pub seconds: f64,
    pub output_path: String,
    pub snapshot: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderManifest {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub tasks: Vec<RenderTask>,
    pub frame_count: Option<usize>,
    pub base_task: Option<NativeRenderBaseTask>,
    #[serde(default)]
    pub frames: Vec<NativeRenderFrame>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderBaseTask {
    pub snapshot: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderFrame {
    pub frame_index: usize,
    pub timeline_t: f64,
    pub seconds: f64,
    pub output_path: String,
    #[serde(default)]
    pub native_backend_delta: NativeBackendFrameDelta,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeBackendFrameDelta {
    pub time_seconds: Option<f64>,
    pub frame_seed_start: Option<u32>,
    #[serde(default)]
    pub scene_uniform_values: Map<String, Value>,
    #[serde(default)]
    pub display_uniform_values: Map<String, Value>,
}

impl RenderTask {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.frame_count == 0 {
            anyhow::bail!("Invalid task.frameCount: expected > 0");
        }
        if self.frame_index >= self.frame_count {
            anyhow::bail!(
                "Invalid task.frameIndex: {} must be < frameCount ({})",
                self.frame_index,
                self.frame_count
            );
        }
        if !(0.0..=1.0).contains(&self.timeline_t) {
            anyhow::bail!("Invalid task.timelineT: expected [0,1]");
        }
        if !self.seconds.is_finite() || self.seconds < 0.0 {
            anyhow::bail!("Invalid task.seconds: expected finite >= 0");
        }
        if self.output_path.trim().is_empty() {
            anyhow::bail!("Invalid task.outputPath: empty");
        }
        if !self.snapshot.is_object() {
            anyhow::bail!("Invalid task.snapshot: expected object");
        }
        Ok(())
    }
}

impl NativeRenderManifest {
    pub fn validate(&self) -> anyhow::Result<()> {
        match self.format.as_str() {
            NATIVE_RENDER_MANIFEST_V1_FORMAT => self.validate_v1(),
            NATIVE_RENDER_MANIFEST_V2_FORMAT => self.validate_v2(),
            _ => anyhow::bail!("Unsupported manifest format: {}", self.format),
        }
    }

    fn validate_v1(&self) -> anyhow::Result<()> {
        if self.version != 1 {
            anyhow::bail!("Unsupported v1 manifest version: {}", self.version);
        }
        if self.tasks.is_empty() {
            anyhow::bail!("Render manifest v1 must contain at least one task.");
        }
        for (index, task) in self.tasks.iter().enumerate() {
            task.validate()
                .map_err(|error| anyhow::anyhow!("Invalid tasks[{index}]: {error}"))?;
        }
        Ok(())
    }

    fn validate_v2(&self) -> anyhow::Result<()> {
        if self.version != 2 {
            anyhow::bail!("Unsupported v2 manifest version: {}", self.version);
        }
        let frame_count = self
            .frame_count
            .ok_or_else(|| anyhow::anyhow!("Render manifest v2 is missing frameCount."))?;
        if frame_count == 0 {
            anyhow::bail!("Render manifest v2 frameCount must be > 0.");
        }
        if self.frames.len() != frame_count {
            anyhow::bail!(
                "Render manifest v2 frame count mismatch: frameCount={} but frames={}.",
                frame_count,
                self.frames.len()
            );
        }
        let base_task = self
            .base_task
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Render manifest v2 is missing baseTask."))?;
        let base_snapshot = base_task.snapshot.as_object().ok_or_else(|| {
            anyhow::anyhow!("Render manifest v2 baseTask.snapshot must be an object.")
        })?;
        let native_backend = base_snapshot.get("nativeBackend").ok_or_else(|| {
            anyhow::anyhow!("Render manifest v2 baseTask.snapshot.nativeBackend is missing.")
        })?;
        if !native_backend.is_object() {
            anyhow::bail!("Render manifest v2 baseTask.snapshot.nativeBackend must be an object.");
        }
        for (expected_index, frame) in self.frames.iter().enumerate() {
            if frame.frame_index != expected_index {
                anyhow::bail!(
                    "Render manifest v2 frames must be contiguous by frameIndex, expected {} but got {}.",
                    expected_index,
                    frame.frame_index
                );
            }
            if !(0.0..=1.0).contains(&frame.timeline_t) {
                anyhow::bail!(
                    "Invalid frames[{}].timelineT: expected [0,1], got {}",
                    expected_index,
                    frame.timeline_t
                );
            }
            if !frame.seconds.is_finite() || frame.seconds < 0.0 {
                anyhow::bail!(
                    "Invalid frames[{}].seconds: expected finite >= 0, got {}",
                    expected_index,
                    frame.seconds
                );
            }
            if frame.output_path.trim().is_empty() {
                anyhow::bail!("Invalid frames[{}].outputPath: empty", expected_index);
            }
        }
        Ok(())
    }

    pub fn expand_tasks(&self) -> anyhow::Result<Vec<RenderTask>> {
        self.validate()?;
        match self.format.as_str() {
            NATIVE_RENDER_MANIFEST_V1_FORMAT => Ok(self.tasks.clone()),
            NATIVE_RENDER_MANIFEST_V2_FORMAT => self.expand_v2_tasks(),
            _ => anyhow::bail!("Unsupported manifest format: {}", self.format),
        }
    }

    fn expand_v2_tasks(&self) -> anyhow::Result<Vec<RenderTask>> {
        let frame_count = self
            .frame_count
            .ok_or_else(|| anyhow::anyhow!("Render manifest v2 is missing frameCount."))?;
        let base_snapshot = self
            .base_task
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Render manifest v2 is missing baseTask."))?
            .snapshot
            .clone();
        let base_snapshot_obj = base_snapshot.as_object().ok_or_else(|| {
            anyhow::anyhow!("Render manifest v2 baseTask.snapshot must be an object.")
        })?;
        let mut previous_native_backend = base_snapshot_obj
            .get("nativeBackend")
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!("Render manifest v2 baseTask.snapshot.nativeBackend is missing.")
            })?;
        if !previous_native_backend.is_object() {
            anyhow::bail!("Render manifest v2 baseTask.snapshot.nativeBackend must be an object.");
        }

        let mut tasks = Vec::with_capacity(frame_count);
        for frame in &self.frames {
            let mut current_native_backend = previous_native_backend.clone();
            apply_native_backend_delta(
                &mut current_native_backend,
                &frame.native_backend_delta,
                frame.frame_index,
            )?;

            let snapshot = serde_json::json!({
                "nativeBackend": current_native_backend
            });
            let task = RenderTask {
                frame_index: frame.frame_index,
                frame_count,
                timeline_t: frame.timeline_t,
                seconds: frame.seconds,
                output_path: frame.output_path.clone(),
                snapshot,
            };
            task.validate().map_err(|error| {
                anyhow::anyhow!("Invalid expanded task {}: {error}", frame.frame_index)
            })?;
            tasks.push(task);
            previous_native_backend = current_native_backend;
        }
        Ok(tasks)
    }
}

fn apply_native_backend_delta(
    native_backend: &mut Value,
    delta: &NativeBackendFrameDelta,
    frame_index: usize,
) -> anyhow::Result<()> {
    let native_backend_obj = native_backend.as_object_mut().ok_or_else(|| {
        anyhow::anyhow!(
            "Invalid nativeBackend object while applying frame {} delta.",
            frame_index
        )
    })?;

    if let Some(time_seconds) = delta.time_seconds {
        if !time_seconds.is_finite() || time_seconds < 0.0 {
            anyhow::bail!(
                "Invalid frames[{}].nativeBackendDelta.timeSeconds: expected finite >= 0",
                frame_index
            );
        }
        native_backend_obj.insert("timeSeconds".to_owned(), Value::from(time_seconds));
    }
    if let Some(frame_seed_start) = delta.frame_seed_start {
        if frame_seed_start == 0 {
            anyhow::bail!(
                "Invalid frames[{}].nativeBackendDelta.frameSeedStart: expected > 0",
                frame_index
            );
        }
        native_backend_obj.insert("frameSeedStart".to_owned(), Value::from(frame_seed_start));
    }

    apply_uniform_value_deltas(
        native_backend_obj,
        "sceneUniforms",
        &delta.scene_uniform_values,
        frame_index,
    )?;
    apply_uniform_value_deltas(
        native_backend_obj,
        "displayUniforms",
        &delta.display_uniform_values,
        frame_index,
    )?;
    Ok(())
}

fn apply_uniform_value_deltas(
    native_backend_obj: &mut Map<String, Value>,
    uniform_list_key: &str,
    value_deltas: &Map<String, Value>,
    frame_index: usize,
) -> anyhow::Result<()> {
    if value_deltas.is_empty() {
        return Ok(());
    }
    let uniform_list = native_backend_obj
        .get_mut(uniform_list_key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Invalid nativeBackend.{} while applying frame {} delta.",
                uniform_list_key,
                frame_index
            )
        })?;

    for (entry_index_key, uniform_value) in value_deltas {
        let entry_index = entry_index_key.parse::<usize>().map_err(|_| {
            anyhow::anyhow!(
                "Invalid uniform index '{}' in frames[{}].nativeBackendDelta for {}.",
                entry_index_key,
                frame_index,
                uniform_list_key
            )
        })?;
        if entry_index >= uniform_list.len() {
            anyhow::bail!(
                "Uniform index '{}' is out of range for nativeBackend.{} (len={}) in frames[{}].",
                entry_index,
                uniform_list_key,
                uniform_list.len(),
                frame_index
            );
        }
        let entry_obj = uniform_list[entry_index].as_object_mut().ok_or_else(|| {
            anyhow::anyhow!(
                "Invalid nativeBackend.{}[{}] while applying frame {} delta.",
                uniform_list_key,
                entry_index_key,
                frame_index
            )
        })?;
        entry_obj.insert("value".to_owned(), uniform_value.clone());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::NativeRenderManifest;

    #[test]
    fn validates_native_manifest_v1() {
        let manifest: NativeRenderManifest = serde_json::from_value(json!({
            "format": "fragmentarium-web-animation-render-manifest-v1",
            "version": 1,
            "tasks": [
                {
                    "frameIndex": 0,
                    "frameCount": 1,
                    "timelineT": 0.0,
                    "seconds": 0.0,
                    "outputPath": "frame_00000.png",
                    "snapshot": {
                        "nativeBackend": {}
                    }
                }
            ]
        }))
        .expect("manifest JSON should deserialize");
        manifest.validate().expect("manifest should validate");
    }

    #[test]
    fn rejects_unknown_manifest_format() {
        let manifest: NativeRenderManifest = serde_json::from_value(json!({
            "format": "other-format",
            "version": 1,
            "tasks": [
                {
                    "frameIndex": 0,
                    "frameCount": 1,
                    "timelineT": 0.0,
                    "seconds": 0.0,
                    "outputPath": "frame_00000.png",
                    "snapshot": {}
                }
            ]
        }))
        .expect("manifest JSON should deserialize");
        let error = manifest
            .validate()
            .expect_err("manifest format must fail validation");
        assert!(error.to_string().contains("Unsupported manifest format"));
    }

    #[test]
    fn expands_native_manifest_v2_into_tasks() {
        let manifest: NativeRenderManifest = serde_json::from_value(json!({
            "format": "fragmentarium-web-animation-render-manifest-v2",
            "version": 2,
            "frameCount": 2,
            "baseTask": {
                "snapshot": {
                    "nativeBackend": {
                        "width": 1920,
                        "height": 1080,
                        "maxSubframes": 10,
                        "tileCount": 1,
                        "tilesPerFrame": 1,
                        "timeSeconds": 0.0,
                        "frameSeedStart": 1,
                        "sceneVertexShader": "#version 300 es\nvoid main(){}",
                        "sceneFragmentShader": "#version 300 es\nvoid main(){}",
                        "sceneUniforms": [
                            { "name": "uTime", "kind": "float", "value": 0.0 },
                            { "name": "Scale", "kind": "float", "value": 1.0 }
                        ],
                        "displayUniforms": [
                            { "name": "uToneMapping", "kind": "int", "value": 4 }
                        ]
                    }
                }
            },
            "frames": [
                {
                    "frameIndex": 0,
                    "timelineT": 0.0,
                    "seconds": 0.0,
                    "outputPath": "frame_00000.png",
                    "nativeBackendDelta": {}
                },
                {
                    "frameIndex": 1,
                    "timelineT": 1.0,
                    "seconds": 0.1,
                    "outputPath": "frame_00001.png",
                    "nativeBackendDelta": {
                        "timeSeconds": 0.1,
                        "frameSeedStart": 2,
                        "sceneUniformValues": {
                            "0": 0.1,
                            "1": 2.0
                        }
                    }
                }
            ]
        }))
        .expect("manifest JSON should deserialize");
        manifest.validate().expect("manifest v2 should validate");
        let tasks = manifest
            .expand_tasks()
            .expect("manifest v2 should expand into tasks");
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].frame_index, 0);
        assert_eq!(tasks[1].frame_index, 1);
        assert_eq!(tasks[1].frame_count, 2);
        assert_eq!(tasks[1].output_path, "frame_00001.png");
        let frame1_backend = tasks[1]
            .snapshot
            .get("nativeBackend")
            .and_then(|value| value.as_object())
            .expect("expanded task should contain nativeBackend object");
        assert_eq!(
            frame1_backend
                .get("timeSeconds")
                .and_then(|value| value.as_f64())
                .unwrap_or(-1.0),
            0.1
        );
        let frame1_scene_uniforms = frame1_backend
            .get("sceneUniforms")
            .and_then(|value| value.as_array())
            .expect("sceneUniforms should be an array");
        let scale_uniform = frame1_scene_uniforms
            .iter()
            .find(|entry| entry.get("name").and_then(|value| value.as_str()) == Some("Scale"))
            .expect("Scale uniform should exist");
        assert_eq!(
            scale_uniform
                .get("value")
                .and_then(|value| value.as_f64())
                .unwrap_or(-1.0),
            2.0
        );
    }
}
