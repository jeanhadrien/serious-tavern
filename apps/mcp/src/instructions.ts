/**
 * The primer a client shows the model when it connects. Only what the tools cannot say themselves: what the app is and
 * the habits that save a round trip. The details live in the guides (`read_guide`).
 */
export const INSTRUCTIONS = `Tools for Serious Tavern, a single-user chatbot app. Each chat reply comes from a workflow: a graph of nodes (history, prompt, model call, memory...) that the user edits visually. You can read and write the building blocks: presets (prompt templates), workflows, characters and personas, and read providers and their models, story state definitions and collections. You cannot delete anything, touch secrets or run chats.

Start with read_guide when you need to know how something works (topics: workflows, presets, templating, ...). Every list_ tool returns summaries (id, name, description); call the matching get_ tool for a full record, and list_provider_models for model ids.

Working with workflows:
- Node ids and edge ids are chosen by you and must be unique inside the workflow. A node may omit its position: the server lays it out.
- Before wiring edges, call get_node_type for each type you use (list_node_types only gives names), and resolve_ports for types with dynamic ports. An edge must connect an existing output port to an existing input port of compatible types.
- create_workflow and update_workflow always save, even when the workflow is incomplete. Read the answer: droppedEdgeIds are edges that were not stored (their ports do not exist) and issues are what still prevents the workflow from running. Fix them and update again; validate_workflow re-checks a stored workflow.
- update_workflow replaces the whole workflow: start from get_workflow and send back everything you want to keep.

Working with presets: entry and input ids are re-derived on every save, so continue from the record a create or update returns, not from what you sent. A preset's rules the schema cannot show (template keys, placement) come back as plain error messages: read them. preview_preset renders a preset without saving it.

An error is reported as "Error <status> <CODE>: <message>", with details when there are some. If the app is not reachable, it has to be started first.`;
