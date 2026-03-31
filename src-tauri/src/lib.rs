mod commands;
mod db;
mod github;
mod lmstudio;
mod reviewer;
mod state;

use state::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state.clone())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start the PR polling loop in a background task
            let handle = app.handle().clone();
            let state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                reviewer::start_polling_loop(handle, state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_github_pat,
            commands::set_watched_repos,
            commands::add_watched_repo,
            commands::remove_watched_repo,
            commands::set_selected_model,
            commands::set_poll_interval,
            commands::toggle_polling,
            commands::get_status,
            commands::validate_github_pat,
            commands::check_lmstudio,
            commands::list_models,
            commands::get_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
