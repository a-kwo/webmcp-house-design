# WebMCP Home Design

A 3D floorplan editor where a human and an AI agent design the same house at
the same time. The app registers 21 tools on `document.modelContext`
([WebMCP](https://github.com/webmachinelearning/webmcp)), so an agent in the
browser — ChatGPT's in-app browser, or Chrome with WebMCP enabled — reads and
edits the *live* design the human is looking at: same rooms, same furniture,
same constraint engine refereeing both of them.

**Live:** https://webmcphousedesign.netlify.app

## What it does

- **Pick a shell, then make it yours.** Choose how many floors and a starting
  layout per floor, then reshape rooms, cut doors and windows, and furnish
  from a 19-piece catalog — by direct manipulation (drag, rotate ring, resize
  steppers) or by asking an agent.
- **One rulebook for everyone.** Every edit — human drag or agent tool call —
  runs through the same operations: identical grid snapping, wall-face
  boundaries, fit rules, and refusal messages. A simplified residential
  constraint engine (13 rules: door widths, bedroom egress, kitchen aisles,
  toilet clearances, furniture facing walls, …) validates after every change
  and reports violations to both parties.
- **The agent can show its work.** `set_camera` walks the human through a
  room; `propose_variants` ghosts up to three alternative wall layouts over
  the plan for the human to compare and apply with one click.
- **Designs persist.** Autosave to the browser, export/import as JSON, and
  share links that carry the whole compressed design in the URL fragment —
  no server, no accounts.

## Try it with an agent

**ChatGPT in-app browser:** open the live URL inside ChatGPT (GPT-5.6 Sol or
Terra), enable site tools under Settings → Browser → Permissions, and ask
things like:

> "Anything wrong with this plan?" · "Furnish the bedroom for a remote
> worker" · "Give me three options for a bigger kitchen"

**Chrome 149+:** enable `chrome://flags/#enable-webmcp-testing`, open the
live URL, and connect any WebMCP-capable agent.

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 267 tests
npm run build      # production bundle in dist/
```

No API keys, no backend, no fetched assets: every texture and furniture model
is generated procedurally at load, so the app works fully offline.

## The tools

| Group | Tools |
| --- | --- |
| Read | `get_layout` · `compute_areas` · `validate_layout` · `get_selection` · `get_camera` |
| Structure | `move_wall` · `resize_room` · `add_room` · `add_opening` · `update_opening` · `remove_element` |
| Furniture | `place_furniture` · `move_furniture` · `resize_furniture` |
| Batch | `apply_edits` (up to 20 edits in one call, continue-on-error) |
| Templates & floors | `list_templates` · `start_from_template` · `set_active_floor` |
| Collaboration | `set_camera` · `propose_variants` (+ `apply_variant`, registered while proposals are on screen) · `undo` |

Every write returns the same envelope — success or an actionable refusal,
what changed, a summary, and the violations that edit caused — so an agent
sees the constraint consequences of its own work without a second call.

## How it's built

```
src/domain     rooms/walls/openings model, operations, constraint engine
src/state      zustand store: floors, undo, selection, persistence
src/mcp        WebMCP tool registration (zod schemas → JSON schema)
src/ui         React Three Fiber scene, palette, rails, template picker
```

- **Shared-wall model:** one wall per physical partition, segmented where
  rooms meet, so an edit can never desynchronize two copies of a wall.
- **Operations are pure:** clone in, `{ok, plan, changed, summary}` out;
  the store applies them and keeps per-floor undo history.
- **Procedural everything:** canvas-painted textures with bump/roughness
  maps, parametric furniture built from primitives — a resized sofa grows a
  third cushion.

## License

[MIT](LICENSE)
