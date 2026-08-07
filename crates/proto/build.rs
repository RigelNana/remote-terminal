fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../../proto/terminal.proto");
    let mut config = prost_build::Config::new();
    config.type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]");
    config.bytes([
        ".remote.v1.Input.data",
        ".remote.v1.Output.data",
        ".remote.v1.Snapshot.data",
    ]);
    config.compile_protos(&["../../proto/terminal.proto"], &["../../proto"])?;
    Ok(())
}
