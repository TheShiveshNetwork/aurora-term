# Persistent UI Settings & Layout Management Plan

## Current Problems

1. **Mixed concerns**: `AppConfig` stores both user preferences (theme, font, keybindings) **and** transient UI state (sidebar collapsed, tabs visible) in the same TOML file — TOML is written on every UI state change via `usePersistUIState`, risking corruption and coupling
2. **Keybinding overrides not persisted**: `useSettingsStore.keybindingOverrides` exists in memory but is never saved to disk
3. **No window geometry**: Position, size, maximized state never saved
4. **No panel layout**: Split pane proportions, sidebar/overlay widths not persisted
5. **Save flow is manual**: Settings page builds a full `AppConfig` from stores and writes all at once; `usePersistUIState` creates a competing write path to the same file

## Proposed Architecture — Three Layers

| Layer | File | Format | Change Frequency | Persistence Strategy |
|---|---|---|---|---|
| **Settings** (preferences) | `settings.toml` | TOML | Rare (manual save) | Explicit save button |
| **Layout** (window/panels) | `layout.json` | JSON | Frequent (resize/drag) | Debounced auto-save (1s) |
| **Session** (open tabs) | SQLite (existing) | SQL | Moderate | Real-time via `aurora-db` |

Both files live in the same `app_config_dir()` as `config.toml` currently does.

---

## Step-by-Step Implementation

### 1. Rust — Create `aurora-core/src/layout.rs`

New struct, **not** embedded in `AppConfig`:

```rust
pub struct UiLayout {
    pub window: WindowGeometry,
    pub sidebar: SidebarState,
    pub panels: PanelState,
    pub pinned_tabs: Vec<String>,
}
```

- `WindowGeometry`: `x`, `y`, `width`, `height`, `maximized`
- `SidebarState`: `collapsed`, `width`
- `PanelState`: `right_panel_width`, `agent_overlay_width`

All derive `Serialize`/`Deserialize` + `Clone`. `Default` impl with sensible values.

### 2. Rust — Strip `UiStateConfig` from `AppConfig`

Remove `ui: UiStateConfig` field. Remove the `UiStateConfig` struct entirely from `config.rs`.

Add missing preference fields to `AppConfig`:
- `keybinding_overrides: HashMap<String, String>`
- `editor_theme: String`
- `show_minimap: bool`

Add `Default` for these new fields matching `useSettingsStore` initial values.

### 3. Rust — Create `aurora-config/src/layout_loader.rs`

New module separate from `ConfigLoader`:

```
struct LayoutLoader { layout_dir: PathBuf, layout_path: PathBuf }
```

Methods:
- `new(manager)` — resolves path via `app_data_dir()` or `app_config_dir()`
- `load() -> UiLayout` — reads JSON, returns `Default` if missing
- `save(layout)` — atomic write (write to `.tmp`, then `rename`)
- Path: `{app_config_dir}/layout.json`

### 4. Rust — Update `ConfigLoader`

Keep TOML for settings. No functional change needed.

### 5. Rust — Update `AppState` in `aurora-commands/src/state.rs`

Add:
```rust
pub layout: Arc<Mutex<UiLayout>>,
```

Initialize from `LayoutLoader::load()` in `AppState::new()`.

### 6. Rust — New IPC commands

**Create `crates/aurora-commands/src/commands/layout_commands.rs`**:
```
layout_get(state)     -> UiLayout
layout_set(app, state, layout) -> void
```

**Update `config_commands.rs`**: `config_get`/`config_set` no longer include UI state.

### 7. Rust — Window geometry tracking

Hook `on_window_event` in `aurora-app`:
- On `Moved(pos)` — debounce-update `UiLayout.window.x/y`
- On `Resized(size)` — debounce-update `UiLayout.window.width/height`
- On `CloseRequested` — save layout immediately before close

```rust
let layout_state = app.state::<AppState>().layout.clone();
window.on_window_event(move |event| {
    match event {
        WindowEvent::CloseRequested { .. } => { /* save immediately */ }
        WindowEvent::Moved(pos) => { /* debounce update */ }
        _ => {}
    }
});
```

### 8. Frontend — New `useLayoutStore`

```
interface LayoutStore {
  window: { x, y, width, height, maximized }
  sidebar: { collapsed, width }
  panels: { rightPanelWidth, agentOverlayWidth }
  pinnedTabs: string[]
  // setters for each
}
```

Initialized from `layout_get()` on bootstrap.

### 9. Frontend — Rewrite `usePersistLayout`

Replace `usePersistUIState.ts`:
- Subscribe to `useLayoutStore` and `useAppShellStore` (for sidebar collapse)
- Debounce 1s, call `layout.set(...)` directly (no round-trip `config.get → mutate → config.set`)
- Subscribe to `useSessionStore` for pinned tabs changes
- On unmount, flush immediately

### 10. Frontend — Split `ipc.ts` config into `settings` + `layout`

```typescript
// Current
export const config = { get, set }  // carries UiStateConfig

// New
export const settings = { get, set }  // pure AppConfig without ui field
export const layout = { get, set }    // UiLayout
```

### 11. Frontend — Update `useAppBootstrap`

- Call `settings.get()` AND `layout.get()` separately
- Apply layout: `getCurrentWindow().setSize()`, `setPosition()`, `setFullscreen()` (if maximized)
- Apply settings to stores: theme, font, keybinding overrides, etc.
- Remove `cfg.ui.*` references entirely

### 12. Frontend — Update `SettingsPage.tsx`

- Remove `UiStateConfig` from `buildAppConfig()`
- On save, call `settings.set()` only

### 13. Frontend — Keybinding overrides persistence

Add a small sync in `useAppBootstrap` or a new effect that saves `keybindingOverrides` to `settings.toml` via `settings.set()` when they change.

---

## Migration / Backward Compatibility

1. **On first launch** after this change, `config.toml` may still have `[ui]` section. Serde's default behavior (without `deny_unknown_fields`) silently ignores unknown fields — the old `[ui]` section is ignored when loading, and `layout.json` is created with defaults.
2. If `layout.json` is missing, `LayoutLoader::load()` returns `Default`.

---

## Files to Create

| File | Purpose |
|---|---|
| `crates/aurora-core/src/layout.rs` | `UiLayout` struct definition |
| `crates/aurora-config/src/layout_loader.rs` | `LayoutLoader` — load/save layout JSON |
| `app/src/stores/useLayoutStore.ts` | Zustand layout store |
| `crates/aurora-commands/src/commands/layout_commands.rs` | IPC commands for layout |

## Files to Modify

| File | Change |
|---|---|
| `crates/aurora-core/src/config.rs` | Remove `UiStateConfig`, remove `ui` field, add `keybinding_overrides`, `editor_theme`, `show_minimap` |
| `crates/aurora-core/src/lib.rs` | Add `pub mod layout;` |
| `crates/aurora-config/src/lib.rs` | Export `layout_loader` |
| `crates/aurora-commands/src/state.rs` | Add `layout: Arc<Mutex<UiLayout>>` |
| `crates/aurora-commands/src/commands/mod.rs` | Register `layout_commands` |
| `crates/aurora-commands/src/commands/config_commands.rs` | `config_get`/`config_set` drop UI state |
| `app/src/lib/ipc.ts` | Split into `settings` + `layout` |
| `app/src/hooks/useAppBootstrap.ts` | Load layout, apply window geometry |
| `app/src/hooks/usePersistUIState.ts` | → `usePersistLayout.ts` — new store + direct save |
| `app/src/stores/useSettingsStore.ts` | Init from config, add keybinding override sync |
| `app/src/components/settings/SettingsPage.tsx` | Remove `UiStateConfig`, save via `settings.set()` |
| `packages/types/src/` | Add `UiLayout` types if needed |

---

## Data Flow Diagram (After)

```
[Layout Changes] → useLayoutStore → usePersistLayout (debounce 1s)
                                        ↓
                                   layout.set(UiLayout) → IPC → LayoutLoader → layout.json
                                        ↓
                              on restart: layout.get() → apply geometry

[Settings Save] → SettingsPage → settings.set(AppConfig) → IPC → ConfigLoader → settings.toml
                                        ↓
                              on restart: settings.get() → hydrate stores

[Window Close] → on_window_event → save geometry immediately → layout.json
```
