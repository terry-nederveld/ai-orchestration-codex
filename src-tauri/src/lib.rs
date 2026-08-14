use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlPlaneConnection {
    url: String,
    token: String,
    #[serde(default)]
    config_path: String,
}

#[derive(Default)]
struct ControlPlaneState(Mutex<ControlPlaneProcess>);

#[derive(Default)]
struct ControlPlaneProcess {
    child: Option<CommandChild>,
    connection: Option<ControlPlaneConnection>,
}

#[tauri::command]
async fn start_control_plane(
    app: AppHandle,
    state: State<'_, ControlPlaneState>,
) -> Result<ControlPlaneConnection, String> {
    if let Some(connection) = state
        .0
        .lock()
        .map_err(|_| "Control-plane state lock is poisoned".to_string())?
        .connection
        .clone()
    {
        return Ok(connection);
    }

    let config_path = resolve_config_path(&app)?;
    let config_value = config_path.to_string_lossy().into_owned();
    let sidecar = app
        .shell()
        .sidecar("fable-control-plane")
        .map_err(|error| format!("Unable to prepare the control plane: {error}"))?
        .args([
            "--config",
            config_value.as_str(),
            "--json",
            "serve",
            "--port",
            "0",
        ]);
    let (mut events, child) = sidecar
        .spawn()
        .map_err(|error| format!("Unable to start the control plane: {error}"))?;

    let ready = tokio::time::timeout(Duration::from_secs(20), async {
        let mut stderr = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if value.get("type").and_then(|entry| entry.as_str())
                            == Some("fable.control-plane.ready")
                        {
                            return serde_json::from_value::<ControlPlaneConnection>(value)
                                .map_err(|error| format!("Invalid startup response: {error}"));
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    stderr.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => return Err(error),
                CommandEvent::Terminated(payload) => {
                    return Err(format!(
                        "Control plane stopped during startup ({:?}): {}",
                        payload.code,
                        stderr.trim()
                    ));
                }
                _ => {}
            }
        }
        Err("Control plane closed its startup channel".to_string())
    })
    .await
    .map_err(|_| "Control plane did not become ready within 20 seconds".to_string())??;

    let connection = ControlPlaneConnection {
        config_path: config_value,
        ..ready
    };
    let mut process = state
        .0
        .lock()
        .map_err(|_| "Control-plane state lock is poisoned".to_string())?;
    process.child = Some(child);
    process.connection = Some(connection.clone());
    Ok(connection)
}

fn resolve_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("FABLE_CONFIG_PATH") {
        let path = PathBuf::from(path);
        if !path.is_file() {
            return Err(format!(
                "FABLE_CONFIG_PATH does not name a file: {}",
                path.display()
            ));
        }
        return Ok(path);
    }
    let current = PathBuf::from("fable.config.yaml");
    if current.is_file() {
        return fs::canonicalize(current).map_err(|error| error.to_string());
    }
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Unable to find the application config directory: {error}"))?;
    let path = directory.join("fable.config.yaml");
    bootstrap_config(&path)?;
    Ok(path)
}

fn bootstrap_config(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Configuration path has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create the config directory: {error}"))?;
    fs::write(
        path,
        "version: 1\ndataDirectory: data\nworkspaceRoot: data/workspaces\npermissions: []\nmodels: []\nagents: []\nwork: []\nworkflows: []\n",
    )
    .map_err(|error| format!("Unable to create the starter configuration: {error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ControlPlaneState::default())
        .invoke_handler(tauri::generate_handler![start_control_plane])
        .build(tauri::generate_context!())
        .expect("failed to build Fable desktop application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<ControlPlaneState>();
                if let Ok(mut process) = state.0.lock() {
                    if let Some(child) = process.child.take() {
                        let _ = child.kill();
                    }
                };
            }
        });
}
