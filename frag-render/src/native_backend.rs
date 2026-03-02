use std::fs;
use std::path::Path;
use std::time::Instant;

use anyhow::{anyhow, Context};
use glfw::{Context as _, WindowHint, WindowMode};
use glow::HasContext;
use image::{ImageBuffer, Rgba};
use serde::Deserialize;
use serde_json::Value;

use crate::schema::RenderTask;

fn apply_gpu_profile(profile: &str) -> anyhow::Result<()> {
    match profile {
        "auto" => {}
        "integrated" => {
            std::env::set_var("DRI_PRIME", "0");
            std::env::set_var("__NV_PRIME_RENDER_OFFLOAD", "0");
        }
        "discrete" => {
            std::env::set_var("DRI_PRIME", "1");
            std::env::set_var("__NV_PRIME_RENDER_OFFLOAD", "1");
            std::env::set_var("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
        }
        other => anyhow::bail!(
            "Unsupported gpu profile '{}'. Expected: auto | integrated | discrete",
            other
        ),
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct UniformBinding {
    name: String,
    kind: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeBackendConfig {
    width: u32,
    height: u32,
    max_subframes: u32,
    tile_count: u32,
    tiles_per_frame: u32,
    time_seconds: f64,
    frame_seed_start: u32,
    scene_vertex_shader: String,
    scene_fragment_shader: String,
    scene_uniforms: Vec<UniformBinding>,
    display_uniforms: Vec<UniformBinding>,
}

#[derive(Debug, Clone)]
pub struct BackendRenderReport {
    pub vendor: String,
    pub renderer: String,
    pub version: String,
    pub init_ms: f64,
    pub compose_ms: f64,
    pub render_ms: f64,
    pub readback_ms: f64,
    pub write_ms: f64,
    pub total_ms: f64,
}

struct RenderTarget {
    framebuffer: glow::NativeFramebuffer,
    texture: glow::NativeTexture,
    width: i32,
    height: i32,
}

#[derive(Clone, Copy)]
struct TileRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

fn native_backend_config_from_task(task: &RenderTask) -> anyhow::Result<NativeBackendConfig> {
    let snapshot = task
        .snapshot
        .as_object()
        .context("Task snapshot must be an object")?;
    let native_backend = snapshot
        .get("nativeBackend")
        .cloned()
        .context("Task snapshot is missing required snapshot.nativeBackend object")?;
    let config: NativeBackendConfig = serde_json::from_value(native_backend)
        .context("Failed to parse snapshot.nativeBackend config")?;
    if config.width == 0 || config.height == 0 {
        anyhow::bail!("Task snapshot.nativeBackend has invalid width/height");
    }
    if config.max_subframes == 0 {
        anyhow::bail!("Task snapshot.nativeBackend has maxSubframes=0");
    }
    if config.scene_vertex_shader.trim().is_empty() {
        anyhow::bail!("Task snapshot.nativeBackend.sceneVertexShader is empty");
    }
    if config.scene_fragment_shader.trim().is_empty() {
        anyhow::bail!("Task snapshot.nativeBackend.sceneFragmentShader is empty");
    }
    Ok(config)
}

fn adapt_glsl_for_desktop_core(source: &str) -> String {
    let mut out = String::with_capacity(source.len() + 32);
    let mut replaced_version = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if !replaced_version && trimmed.starts_with("#version 300 es") {
            out.push_str("#version 330 core\n");
            replaced_version = true;
            continue;
        }
        if trimmed.starts_with("precision ") {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !replaced_version {
        return source.to_owned();
    }
    out
}

#[derive(Clone, Copy)]
struct DisplayToneSettings {
    gamma: f32,
    exposure: f32,
    tone_mapping: i32,
    brightness: f32,
    contrast: f32,
    saturation: f32,
}

fn find_display_uniform<'a>(
    uniforms: &'a [UniformBinding],
    name: &str,
) -> Option<&'a UniformBinding> {
    uniforms.iter().find(|entry| entry.name == name)
}

fn display_tone_settings(config: &NativeBackendConfig) -> anyhow::Result<DisplayToneSettings> {
    let gamma = find_display_uniform(&config.display_uniforms, "uGamma")
        .and_then(|entry| entry.value.as_f64())
        .unwrap_or(2.2) as f32;
    let exposure = find_display_uniform(&config.display_uniforms, "uExposure")
        .and_then(|entry| entry.value.as_f64())
        .unwrap_or(1.0) as f32;
    let tone_mapping = find_display_uniform(&config.display_uniforms, "uToneMapping")
        .and_then(|entry| entry.value.as_i64())
        .unwrap_or(4) as i32;
    let brightness = find_display_uniform(&config.display_uniforms, "uBrightness")
        .and_then(|entry| entry.value.as_f64())
        .unwrap_or(1.0) as f32;
    let contrast = find_display_uniform(&config.display_uniforms, "uContrast")
        .and_then(|entry| entry.value.as_f64())
        .unwrap_or(1.0) as f32;
    let saturation = find_display_uniform(&config.display_uniforms, "uSaturation")
        .and_then(|entry| entry.value.as_f64())
        .unwrap_or(1.0) as f32;

    if !gamma.is_finite()
        || !exposure.is_finite()
        || !brightness.is_finite()
        || !contrast.is_finite()
        || !saturation.is_finite()
    {
        anyhow::bail!("Display tone settings must be finite values");
    }

    Ok(DisplayToneSettings {
        gamma,
        exposure,
        tone_mapping,
        brightness,
        contrast,
        saturation,
    })
}

fn tone_map_aces_fitted(color: [f32; 3]) -> [f32; 3] {
    let a = 2.51_f32;
    let b = 0.03_f32;
    let c = 2.43_f32;
    let d = 0.59_f32;
    let e = 0.14_f32;
    [
        ((color[0] * (a * color[0] + b)) / (color[0] * (c * color[0] + d) + e)).clamp(0.0, 1.0),
        ((color[1] * (a * color[1] + b)) / (color[1] * (c * color[1] + d) + e)).clamp(0.0, 1.0),
        ((color[2] * (a * color[2] + b)) / (color[2] * (c * color[2] + d) + e)).clamp(0.0, 1.0),
    ]
}

fn contrast_saturation_brightness(color: [f32; 3], brt: f32, sat: f32, con: f32) -> [f32; 3] {
    let lum_coeff = [0.2126_f32, 0.7152_f32, 0.0722_f32];
    let avg_lum = [0.5_f32, 0.5_f32, 0.5_f32];
    let brt_color = [color[0] * brt, color[1] * brt, color[2] * brt];
    let intensity =
        brt_color[0] * lum_coeff[0] + brt_color[1] * lum_coeff[1] + brt_color[2] * lum_coeff[2];
    let sat_color = [
        intensity + (brt_color[0] - intensity) * sat,
        intensity + (brt_color[1] - intensity) * sat,
        intensity + (brt_color[2] - intensity) * sat,
    ];
    [
        avg_lum[0] + (sat_color[0] - avg_lum[0]) * con,
        avg_lum[1] + (sat_color[1] - avg_lum[1]) * con,
        avg_lum[2] + (sat_color[2] - avg_lum[2]) * con,
    ]
}

fn apply_display_tone_map(color: [f32; 3], settings: DisplayToneSettings) -> [f32; 3] {
    let mut c = [color[0].max(0.0), color[1].max(0.0), color[2].max(0.0)];
    if settings.tone_mapping == 1 {
        c = [
            c[0] * settings.exposure,
            c[1] * settings.exposure,
            c[2] * settings.exposure,
        ];
    } else if settings.tone_mapping == 2 {
        c = [
            1.0 - (-c[0] * settings.exposure).exp(),
            1.0 - (-c[1] * settings.exposure).exp(),
            1.0 - (-c[2] * settings.exposure).exp(),
        ];
    } else if settings.tone_mapping == 3 {
        c = tone_map_aces_fitted([
            c[0] * settings.exposure,
            c[1] * settings.exposure,
            c[2] * settings.exposure,
        ]);
    } else {
        c = [
            c[0] * settings.exposure,
            c[1] * settings.exposure,
            c[2] * settings.exposure,
        ];
        c = [
            c[0] / (1.0 + c[0]),
            c[1] / (1.0 + c[1]),
            c[2] / (1.0 + c[2]),
        ];
    }
    c = contrast_saturation_brightness(
        c,
        settings.brightness,
        settings.saturation,
        settings.contrast,
    );
    let gamma = settings.gamma.max(1.0e-4);
    let inv_gamma = 1.0 / gamma;
    [
        c[0].max(0.0).powf(inv_gamma),
        c[1].max(0.0).powf(inv_gamma),
        c[2].max(0.0).powf(inv_gamma),
    ]
}

unsafe fn compile_shader(
    gl: &glow::Context,
    shader_type: u32,
    source: &str,
    label: &str,
) -> anyhow::Result<glow::NativeShader> {
    let shader = gl
        .create_shader(shader_type)
        .map_err(|error| anyhow!("Failed to create {label} shader object: {error}"))?;
    gl.shader_source(shader, source);
    gl.compile_shader(shader);
    if !gl.get_shader_compile_status(shader) {
        let log = gl.get_shader_info_log(shader);
        gl.delete_shader(shader);
        anyhow::bail!("{label} shader compile failed: {log}");
    }
    Ok(shader)
}

unsafe fn link_program(
    gl: &glow::Context,
    vertex_shader: glow::NativeShader,
    fragment_shader: glow::NativeShader,
) -> anyhow::Result<glow::NativeProgram> {
    let program = gl
        .create_program()
        .map_err(|error| anyhow!("Failed to create GL program: {error}"))?;
    gl.attach_shader(program, vertex_shader);
    gl.attach_shader(program, fragment_shader);
    gl.link_program(program);
    gl.detach_shader(program, vertex_shader);
    gl.detach_shader(program, fragment_shader);
    if !gl.get_program_link_status(program) {
        let log = gl.get_program_info_log(program);
        gl.delete_program(program);
        anyhow::bail!("Program link failed: {log}");
    }
    Ok(program)
}

unsafe fn set_uniform(
    gl: &glow::Context,
    program: glow::NativeProgram,
    name: &str,
    kind: &str,
    value: &Value,
) -> anyhow::Result<()> {
    let Some(location) = gl.get_uniform_location(program, name) else {
        return Ok(());
    };

    match kind {
        "float" => {
            let scalar = value
                .as_f64()
                .with_context(|| format!("Uniform '{name}' expected float"))?
                as f32;
            gl.uniform_1_f32(Some(&location), scalar);
        }
        "int" => {
            let scalar = value
                .as_i64()
                .with_context(|| format!("Uniform '{name}' expected int"))?
                as i32;
            gl.uniform_1_i32(Some(&location), scalar);
        }
        "bool" => {
            let scalar = if let Some(flag) = value.as_bool() {
                if flag {
                    1
                } else {
                    0
                }
            } else if let Some(num) = value.as_i64() {
                if num == 0 {
                    0
                } else {
                    1
                }
            } else {
                anyhow::bail!("Uniform '{name}' expected bool");
            };
            gl.uniform_1_i32(Some(&location), scalar);
        }
        "vec2" | "vec3" | "vec4" => {
            let components = value
                .as_array()
                .with_context(|| format!("Uniform '{name}' expected array for {kind}"))?;
            let expected = match kind {
                "vec2" => 2,
                "vec3" => 3,
                "vec4" => 4,
                _ => unreachable!(),
            };
            if components.len() != expected {
                anyhow::bail!(
                    "Uniform '{name}' expected {expected} components for {kind}, got {}",
                    components.len()
                );
            }
            let mut floats = Vec::with_capacity(expected);
            for (index, component) in components.iter().enumerate() {
                floats.push(
                    component.as_f64().with_context(|| {
                        format!("Uniform '{name}' component {index} is not numeric")
                    })? as f32,
                );
            }
            match expected {
                2 => gl.uniform_2_f32_slice(Some(&location), &floats),
                3 => gl.uniform_3_f32_slice(Some(&location), &floats),
                4 => gl.uniform_4_f32_slice(Some(&location), &floats),
                _ => unreachable!(),
            }
        }
        other => anyhow::bail!("Unsupported uniform kind '{other}' for '{name}'"),
    }
    Ok(())
}

unsafe fn set_uniform_i32(
    gl: &glow::Context,
    program: glow::NativeProgram,
    name: &str,
    value: i32,
) {
    if let Some(location) = gl.get_uniform_location(program, name) {
        gl.uniform_1_i32(Some(&location), value);
    }
}

unsafe fn set_uniform_f32(
    gl: &glow::Context,
    program: glow::NativeProgram,
    name: &str,
    value: f32,
) {
    if let Some(location) = gl.get_uniform_location(program, name) {
        gl.uniform_1_f32(Some(&location), value);
    }
}

unsafe fn create_render_target(
    gl: &glow::Context,
    width: i32,
    height: i32,
) -> anyhow::Result<RenderTarget> {
    let texture = gl
        .create_texture()
        .map_err(|error| anyhow!("Failed to create render target texture: {error}"))?;
    gl.bind_texture(glow::TEXTURE_2D, Some(texture));
    gl.tex_parameter_i32(
        glow::TEXTURE_2D,
        glow::TEXTURE_WRAP_S,
        glow::CLAMP_TO_EDGE as i32,
    );
    gl.tex_parameter_i32(
        glow::TEXTURE_2D,
        glow::TEXTURE_WRAP_T,
        glow::CLAMP_TO_EDGE as i32,
    );
    gl.tex_parameter_i32(
        glow::TEXTURE_2D,
        glow::TEXTURE_MIN_FILTER,
        glow::NEAREST as i32,
    );
    gl.tex_parameter_i32(
        glow::TEXTURE_2D,
        glow::TEXTURE_MAG_FILTER,
        glow::NEAREST as i32,
    );
    gl.tex_storage_2d(glow::TEXTURE_2D, 1, glow::RGBA32F, width, height);

    let framebuffer = gl
        .create_framebuffer()
        .map_err(|error| anyhow!("Failed to create render target framebuffer: {error}"))?;
    gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
    gl.framebuffer_texture_2d(
        glow::FRAMEBUFFER,
        glow::COLOR_ATTACHMENT0,
        glow::TEXTURE_2D,
        Some(texture),
        0,
    );
    gl.draw_buffers(&[glow::COLOR_ATTACHMENT0]);
    gl.read_buffer(glow::COLOR_ATTACHMENT0);
    let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
    if status != glow::FRAMEBUFFER_COMPLETE {
        gl.delete_framebuffer(framebuffer);
        gl.delete_texture(texture);
        anyhow::bail!(
            "Framebuffer incomplete for accumulation target (status={status}). RGBA32F rendering support is required."
        );
    }

    gl.bind_framebuffer(glow::FRAMEBUFFER, None);
    gl.bind_texture(glow::TEXTURE_2D, None);

    Ok(RenderTarget {
        framebuffer,
        texture,
        width,
        height,
    })
}

unsafe fn clear_render_target(gl: &glow::Context, target: &RenderTarget) {
    gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, Some(target.framebuffer));
    gl.viewport(0, 0, target.width, target.height);
    gl.clear_color(0.0, 0.0, 0.0, 0.0);
    gl.clear(glow::COLOR_BUFFER_BIT);
}

unsafe fn copy_render_target(gl: &glow::Context, from: &RenderTarget, to: &RenderTarget) {
    gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(from.framebuffer));
    gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, Some(to.framebuffer));
    gl.blit_framebuffer(
        0,
        0,
        from.width,
        from.height,
        0,
        0,
        to.width,
        to.height,
        glow::COLOR_BUFFER_BIT,
        glow::NEAREST,
    );
    gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
    gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
}

fn get_tile_rect(index: u32, tile_count: u32, width: i32, height: i32) -> TileRect {
    let tile_x = (index % tile_count) as i32;
    let tile_y = (index / tile_count) as i32;
    let tile_width = ((width as f32) / (tile_count as f32)).ceil() as i32;
    let tile_height = ((height as f32) / (tile_count as f32)).ceil() as i32;

    let x = tile_x * tile_width;
    let y = tile_y * tile_height;
    let width_clamped = (width - x).min(tile_width).max(1);
    let height_clamped = (height - y).min(tile_height).max(1);
    TileRect {
        x,
        y,
        width: width_clamped,
        height: height_clamped,
    }
}

fn next_frame_seed(seed: &mut i32) -> i32 {
    let value = *seed;
    *seed = if *seed >= 2_147_483_646 { 1 } else { *seed + 1 };
    value
}

unsafe fn render_scene_pass(
    gl: &glow::Context,
    scene_program: glow::NativeProgram,
    read_target: &RenderTarget,
    write_target: &RenderTarget,
    subframe: u32,
    frame_index: i32,
    time_seconds: f64,
    tile: Option<TileRect>,
) -> anyhow::Result<()> {
    gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, Some(write_target.framebuffer));
    gl.draw_buffers(&[glow::COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, write_target.width, write_target.height);
    if let Some(rect) = tile {
        gl.enable(glow::SCISSOR_TEST);
        gl.scissor(rect.x, rect.y, rect.width, rect.height);
    } else {
        gl.disable(glow::SCISSOR_TEST);
    }

    gl.use_program(Some(scene_program));
    set_uniform_i32(gl, scene_program, "uSubframe", subframe as i32);
    set_uniform_i32(gl, scene_program, "uFrameIndex", frame_index);
    set_uniform_i32(
        gl,
        scene_program,
        "uUseBackbuffer",
        if subframe > 0 { 1 } else { 0 },
    );
    set_uniform_i32(gl, scene_program, "uBackbuffer", 0);
    set_uniform_f32(gl, scene_program, "uTime", time_seconds as f32);

    gl.active_texture(glow::TEXTURE0);
    gl.bind_texture(glow::TEXTURE_2D, Some(read_target.texture));
    gl.draw_arrays(glow::TRIANGLES, 0, 3);
    let error = gl.get_error();
    if error != glow::NO_ERROR {
        anyhow::bail!("GL error after scene draw: 0x{error:04x}");
    }
    gl.disable(glow::SCISSOR_TEST);
    gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
    Ok(())
}

pub fn render_task_with_native_backend(
    task: &RenderTask,
    gpu_profile: &str,
) -> anyhow::Result<BackendRenderReport> {
    let total_start = Instant::now();
    apply_gpu_profile(gpu_profile)?;

    let compose_start = Instant::now();
    let config = native_backend_config_from_task(task)?;
    let compose_elapsed = compose_start.elapsed();

    let init_start = Instant::now();
    let mut glfw = glfw::init(glfw::log_errors).context("Failed to initialize GLFW")?;
    glfw.window_hint(WindowHint::Visible(false));
    glfw.window_hint(WindowHint::ContextVersion(3, 3));
    glfw.window_hint(WindowHint::OpenGlForwardCompat(true));
    glfw.window_hint(WindowHint::OpenGlProfile(glfw::OpenGlProfileHint::Core));

    let (mut window, _) = glfw
        .create_window(
            config.width,
            config.height,
            "frag-render-backend",
            WindowMode::Windowed,
        )
        .context("Failed to create hidden OpenGL 3.3 core window")?;
    window.make_current();

    let gl = unsafe {
        glow::Context::from_loader_function(|symbol| window.get_proc_address(symbol) as *const _)
    };
    let init_elapsed = init_start.elapsed();

    let output_parent = Path::new(&task.output_path)
        .parent()
        .context("Task output_path has no parent directory")?;
    fs::create_dir_all(output_parent).with_context(|| {
        format!(
            "Failed to create output directory {}",
            output_parent.display()
        )
    })?;

    unsafe {
        let scene_vertex_shader_source = adapt_glsl_for_desktop_core(&config.scene_vertex_shader);
        let scene_fragment_shader_source =
            adapt_glsl_for_desktop_core(&config.scene_fragment_shader);
        let tone_settings = display_tone_settings(&config)?;

        let render_start = Instant::now();
        let scene_vertex = compile_shader(
            &gl,
            glow::VERTEX_SHADER,
            &scene_vertex_shader_source,
            "Scene vertex",
        )?;
        let scene_fragment = compile_shader(
            &gl,
            glow::FRAGMENT_SHADER,
            &scene_fragment_shader_source,
            "Scene fragment",
        )?;
        let scene_program = link_program(&gl, scene_vertex, scene_fragment)?;
        gl.delete_shader(scene_vertex);
        gl.delete_shader(scene_fragment);

        let vao = gl
            .create_vertex_array()
            .map_err(|error| anyhow!("Failed to create VAO: {error}"))?;
        gl.bind_vertex_array(Some(vao));

        let mut read_target = create_render_target(&gl, config.width as i32, config.height as i32)?;
        let mut write_target =
            create_render_target(&gl, config.width as i32, config.height as i32)?;

        clear_render_target(&gl, &read_target);
        clear_render_target(&gl, &write_target);
        gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);

        gl.use_program(Some(scene_program));
        for uniform in &config.scene_uniforms {
            if uniform.name == "uSubframe"
                || uniform.name == "uFrameIndex"
                || uniform.name == "uUseBackbuffer"
            {
                continue;
            }
            set_uniform(
                &gl,
                scene_program,
                &uniform.name,
                &uniform.kind,
                &uniform.value,
            )?;
        }

        let mut frame_seed = i32::max(1, config.frame_seed_start as i32);
        let mut subframe: u32 = 0;
        let mut tile_cursor: u32 = 0;
        let tile_count = u32::max(1, config.tile_count);
        let tiles_per_frame = u32::max(1, config.tiles_per_frame);

        if tile_count > 1 {
            render_scene_pass(
                &gl,
                scene_program,
                &read_target,
                &write_target,
                subframe,
                next_frame_seed(&mut frame_seed),
                config.time_seconds,
                None,
            )?;
            std::mem::swap(&mut read_target, &mut write_target);
            subframe = 1;
        } else {
            clear_render_target(&gl, &read_target);
            clear_render_target(&gl, &write_target);
            gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
        }

        while subframe < config.max_subframes {
            if tile_count <= 1 {
                render_scene_pass(
                    &gl,
                    scene_program,
                    &read_target,
                    &write_target,
                    subframe,
                    next_frame_seed(&mut frame_seed),
                    config.time_seconds,
                    None,
                )?;
                std::mem::swap(&mut read_target, &mut write_target);
                subframe += 1;
                continue;
            }

            let total_tiles = tile_count * tile_count;
            for _ in 0..tiles_per_frame {
                if subframe >= config.max_subframes {
                    break;
                }
                copy_render_target(&gl, &read_target, &write_target);
                let tile = get_tile_rect(
                    tile_cursor,
                    tile_count,
                    write_target.width,
                    write_target.height,
                );
                render_scene_pass(
                    &gl,
                    scene_program,
                    &read_target,
                    &write_target,
                    subframe,
                    next_frame_seed(&mut frame_seed),
                    config.time_seconds,
                    Some(tile),
                )?;
                std::mem::swap(&mut read_target, &mut write_target);

                tile_cursor += 1;
                if tile_cursor >= total_tiles {
                    tile_cursor = 0;
                    subframe += 1;
                }
            }
        }

        gl.finish();
        let render_elapsed = render_start.elapsed();

        let readback_start = Instant::now();
        let pixel_count = (config.width as usize) * (config.height as usize);
        let mut accum_bytes = vec![0u8; pixel_count * 16];
        gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(read_target.framebuffer));
        gl.read_buffer(glow::COLOR_ATTACHMENT0);
        gl.read_pixels(
            0,
            0,
            config.width as i32,
            config.height as i32,
            glow::RGBA,
            glow::FLOAT,
            glow::PixelPackData::Slice(&mut accum_bytes),
        );
        gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
        let readback_elapsed = readback_start.elapsed();

        let mut pixels = vec![0u8; pixel_count * 4];
        for index in 0..pixel_count {
            let accum_offset = index * 16;
            let read_f32 = |offset: usize| -> f32 {
                f32::from_ne_bytes(
                    accum_bytes[(accum_offset + offset)..(accum_offset + offset + 4)]
                        .try_into()
                        .unwrap(),
                )
            };
            let accum_r = read_f32(0);
            let accum_g = read_f32(4);
            let accum_b = read_f32(8);
            let accum_a = read_f32(12).max(1.0e-6);
            let linear = [accum_r / accum_a, accum_g / accum_a, accum_b / accum_a];
            let mapped = apply_display_tone_map(linear, tone_settings);

            let write_offset = index * 4;
            pixels[write_offset] = (mapped[0].clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[write_offset + 1] = (mapped[1].clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[write_offset + 2] = (mapped[2].clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[write_offset + 3] = 255;
        }

        let row_bytes = (config.width as usize) * 4;
        let mut flipped = vec![0u8; pixels.len()];
        for row in 0..(config.height as usize) {
            let src = row * row_bytes;
            let dst = (config.height as usize - 1 - row) * row_bytes;
            flipped[dst..(dst + row_bytes)].copy_from_slice(&pixels[src..(src + row_bytes)]);
        }

        let image: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_vec(config.width, config.height, flipped)
                .context("Failed to create image buffer from rendered pixels")?;
        let write_start = Instant::now();
        image
            .save_with_format(&task.output_path, image::ImageFormat::Png)
            .with_context(|| format!("Failed to save {}", task.output_path))?;
        let write_elapsed = write_start.elapsed();

        let vendor = gl.get_parameter_string(glow::VENDOR);
        let renderer = gl.get_parameter_string(glow::RENDERER);
        let version = gl.get_parameter_string(glow::VERSION);
        let total_elapsed = total_start.elapsed();

        gl.delete_texture(read_target.texture);
        gl.delete_texture(write_target.texture);
        gl.delete_framebuffer(read_target.framebuffer);
        gl.delete_framebuffer(write_target.framebuffer);
        gl.delete_vertex_array(vao);
        gl.delete_program(scene_program);

        let report = BackendRenderReport {
            vendor,
            renderer,
            version,
            init_ms: init_elapsed.as_secs_f64() * 1000.0,
            compose_ms: compose_elapsed.as_secs_f64() * 1000.0,
            render_ms: render_elapsed.as_secs_f64() * 1000.0,
            readback_ms: readback_elapsed.as_secs_f64() * 1000.0,
            write_ms: write_elapsed.as_secs_f64() * 1000.0,
            total_ms: total_elapsed.as_secs_f64() * 1000.0,
        };
        eprintln!(
            "[frag-render] native-render frame={} gpu_profile={} vendor='{}' renderer='{}' gl='{}' timings compose={:.3}ms init={:.3}ms render={:.3}ms readback={:.3}ms write={:.3}ms total={:.3}ms",
            task.frame_index,
            gpu_profile,
            report.vendor,
            report.renderer,
            report.version,
            report.compose_ms,
            report.init_ms,
            report.render_ms,
            report.readback_ms,
            report.write_ms,
            report.total_ms
        );
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use anyhow::Context;
    use serde_json::json;

    use crate::schema::RenderTask;

    use super::{native_backend_config_from_task, render_task_with_native_backend};

    const TEST_WIDTH: u32 = 1280;
    const TEST_HEIGHT: u32 = 720;

    fn build_native_test_task(output_name: &str) -> anyhow::Result<RenderTask> {
        let output_path = PathBuf::from(output_name);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "Failed to create report directory for native backend test: {}",
                    parent.display()
                )
            })?;
        }

        let task = RenderTask {
            frame_index: 0,
            frame_count: 1,
            timeline_t: 0.0,
            seconds: 0.0,
            output_path: output_path.to_string_lossy().to_string(),
            snapshot: json!({
                "nativeBackend": {
                    "width": TEST_WIDTH,
                    "height": TEST_HEIGHT,
                    "maxSubframes": 10,
                    "tileCount": 1,
                    "tilesPerFrame": 1,
                    "timeSeconds": 0,
                    "frameSeedStart": 1,
                    "sceneVertexShader": "#version 300 es\nprecision highp float;\nconst vec2 positions[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));\nvoid main(){ vec2 pos = positions[gl_VertexID]; gl_Position = vec4(pos,0.0,1.0); }\n",
                    "sceneFragmentShader": "#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(0.25, 0.5, 0.75, 1.0); }\n",
                    "sceneUniforms": [],
                    "displayUniforms": [
                        { "name": "uFrontbuffer", "kind": "int", "value": 0 },
                        { "name": "uGamma", "kind": "float", "value": 2.2 },
                        { "name": "uExposure", "kind": "float", "value": 1.0 },
                        { "name": "uToneMapping", "kind": "int", "value": 4 },
                        { "name": "uBrightness", "kind": "float", "value": 1.0 },
                        { "name": "uContrast", "kind": "float", "value": 1.0 },
                        { "name": "uSaturation", "kind": "float", "value": 1.0 }
                    ]
                }
            }),
        };
        Ok(task)
    }

    #[test]
    fn parses_native_backend_config_from_task_snapshot() -> anyhow::Result<()> {
        let task = build_native_test_task("reports/frag-render-tests/native-config-smoke.png")?;
        let config = native_backend_config_from_task(&task)?;
        assert_eq!(config.width, TEST_WIDTH);
        assert_eq!(config.height, TEST_HEIGHT);
        assert!(config.scene_vertex_shader.contains("gl_VertexID"));
        assert!(config.scene_fragment_shader.contains("fragColor"));
        assert!(config
            .display_uniforms
            .iter()
            .any(|uniform| uniform.name == "uToneMapping"));
        Ok(())
    }

    #[test]
    #[ignore = "requires X11/Wayland display (or xvfb) for native OpenGL context"]
    fn backend_render_writes_a_png_file() -> anyhow::Result<()> {
        let task = build_native_test_task("reports/frag-render-tests/native-backend-test.png")?;
        let output_path = PathBuf::from(&task.output_path);

        let _report = render_task_with_native_backend(&task, "auto")?;

        let bytes = fs::read(&output_path)
            .with_context(|| format!("Failed to read rendered PNG {}", output_path.display()))?;
        let png_signature: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
        assert!(bytes.len() > 8, "Rendered PNG is unexpectedly small");
        assert_eq!(&bytes[0..8], &png_signature);

        let image = image::open(&output_path)
            .with_context(|| format!("Failed to decode rendered PNG {}", output_path.display()))?;
        assert_eq!(image.width(), TEST_WIDTH);
        assert_eq!(image.height(), TEST_HEIGHT);
        let rgba = image.to_rgba8();
        let non_black = rgba
            .pixels()
            .filter(|pixel| pixel.0[0] > 8 || pixel.0[1] > 8 || pixel.0[2] > 8)
            .count();
        assert!(
            non_black > ((TEST_WIDTH as usize * TEST_HEIGHT as usize) / 4),
            "Rendered image is mostly black"
        );

        Ok(())
    }

    #[test]
    #[ignore = "requires discrete GPU + display access"]
    fn backend_render_writes_a_png_file_on_discrete_gpu() -> anyhow::Result<()> {
        let task =
            build_native_test_task("reports/frag-render-tests/native-backend-discrete-test.png")?;
        let report = render_task_with_native_backend(&task, "discrete")?;
        let renderer_lower = report.renderer.to_lowercase();
        assert!(
            !renderer_lower.contains("intel"),
            "Discrete profile still used Intel renderer: {}",
            report.renderer
        );
        Ok(())
    }
}
