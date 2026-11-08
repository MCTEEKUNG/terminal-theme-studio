use std::{
    env, fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    thread,
    time::Duration,
};

struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // No console window for FFmpeg.
    }
    command
}

fn run(mut command: Command, cancelled: &AtomicBool) -> Result<Vec<u8>, String> {
    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    let mut child = command.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|e| format!("Cannot start FFmpeg/FFprobe: {e}"))?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let stdout = thread::spawn(move || { let mut bytes = Vec::new(); let _ = out.read_to_end(&mut bytes); bytes });
    let stderr = thread::spawn(move || { let mut bytes = Vec::new(); let _ = err.read_to_end(&mut bytes); bytes });
    let status = loop {
        if cancelled.load(Ordering::Relaxed) { let _ = child.kill(); }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error.to_string()); }
        }
    };
    let output = stdout.join().unwrap_or_default();
    let errors = stderr.join().unwrap_or_default();
    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    if !status.success() { return Err(String::from_utf8_lossy(&errors).into_owned()); }
    Ok(output)
}

fn convert(args: &[String], cancelled: &AtomicBool) -> Result<(), String> {
    if args.len() != 5 { return Err("Usage: studio-gif-worker SOURCE OUTPUT FPS WIDTH".into()); }
    let source = &args[1];
    let output = &args[2];
    let fps = &args[3];
    let width = &args[4];
    if fps != "source" && !fps.parse::<u32>().is_ok_and(|n| (1..=60).contains(&n)) { return Err("Invalid FPS".into()); }
    if width != "source" && !width.parse::<u32>().is_ok_and(|n| (64..=3840).contains(&n)) { return Err("Invalid width".into()); }
    if !Path::new(source).is_file() { return Err("Source not found".into()); }
    let palette = Temporary(PathBuf::from(format!("{output}.palette.png")));
    let temporary_output = Temporary(PathBuf::from(output));
    fs::File::create(output).map_err(|e| e.to_string())?;
    let mut filters = Vec::new();
    if fps != "source" { filters.push(format!("fps={fps}")); }
    if width != "source" { filters.push(format!("scale={width}:-1:flags=lanczos")); }
    let scale = if filters.is_empty() { "null".into() } else { filters.join(",") };

    let mut probe = command("ffprobe");
    probe.args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source]);
    let duration = String::from_utf8_lossy(&run(probe, cancelled)?).trim().parse::<f64>().unwrap_or(0.0);

    // Two bounded-memory passes avoid buffering the entire scaled clip while
    // palettegen waits for EOF (the previous split/palettegen graph did this).
    let mut colors = command("ffmpeg");
    colors.args(["-v", "error", "-y", "-i", source, "-vf", &format!("{scale},palettegen=max_colors=256"), "-frames:v", "1"])
        .arg(&palette.0);
    run(colors, cancelled)?;
    let mut encode = command("ffmpeg");
    encode.args(["-v", "error", "-y", "-i", source, "-i"]).arg(&palette.0)
        .args(["-lavfi", &format!("[0:v]{scale}[video];[video][1:v]paletteuse=dither=bayer"),
            "-fps_mode", "passthrough", "-loop", "0", "-f", "gif", output]);
    run(encode, cancelled)?;
    std::mem::forget(temporary_output); // The controller atomically publishes it.
    println!("{{\"durationSec\":{duration}}}");
    Ok(())
}

fn main() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let input_cancelled = cancelled.clone();
    // EOF also cancels: terminating the controller cannot orphan FFmpeg.
    thread::spawn(move || { let _ = io::stdin().read(&mut [0u8; 1]); input_cancelled.store(true, Ordering::Relaxed); });
    if let Err(error) = convert(&env::args().collect::<Vec<_>>(), &cancelled) {
        eprintln!("{error}");
        std::process::exit(if cancelled.load(Ordering::Relaxed) { 2 } else { 1 });
    }
}
