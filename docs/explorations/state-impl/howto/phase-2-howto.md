# Phase 2: chat settings, how to try it

Chat settings are knobs a workflow declares and each chat sets: a dial, a toggle, a choice, a note. They belong to you. Turns only read them, and editing, deleting or regenerating messages never changes them. A new value applies from the next turn.

## 1. Declare settings on a workflow

1. Open a workflow in the editor (Workflows list on the left, then click one).
2. In the toolbar, click **Chat settings** (sliders icon). A panel opens on the right in place of the node config.
3. Click **Add setting** for each knob. Each row has:
   - **Key:** the name templates use, e.g. `mood`. Use letters, digits and `_`, not starting with a digit.
   - **Type:** number, boolean, enum or text.
   - **Label:** optional; the key is shown otherwise.
   - **Default** (number fields also have Min, Max and Step; enums take their options one per line; text can be set to "Several lines").
   - **Description:** optional.

   The arrow buttons reorder rows and the trash button removes one.
4. Problems show inline as you type, for example a duplicate key, an invalid key, min greater than max, or an enum default that isn't one of its options. The toolbar button counts them ("Chat settings (1 problem(s))").
5. Click **Save**. The settings are part of the workflow draft, so the header dot shows unsaved changes.

Example set:
- `volatility`: number, default 0.3, min 0, max 1, step 0.05
- `flag`: boolean
- `mood`: enum `calm` / `tense`, default `calm`
- `note`: text, several lines

## 2. Use them in the workflow

- **In any template:** a Chat Output template, a Condition's left/right, or a preset entry can read `{{settings.mood}}`, `{{#if settings.flag}}…{{/if}}`, and `{{settings}}` (all values as JSON). Editor hints list the declared keys.
- **As ports:** the new **Chat Settings** node (palette, category Chat) has no inputs. `Settings` outputs every value as an object. `Value` outputs the one named by its **Key** config, and is absent when Key is empty or undeclared, so whatever it feeds is skipped.

Try this graph, which needs no LLM:
- Chat Input `message` → Chat Output with the template `v={{settings.volatility}} mood={{settings.mood}} note={{settings.note}}`.
- Chat Settings (Key `mood`) `Value` → Condition (left `{{settings.mood}}`, equals, right `tense`). Connect `True` to a Chat Output with the template "TENSE" and `False` to one with "calm".

## 3. Set them per chat

1. Start a chat on that workflow.
2. Click the sliders icon in the chat header ("Chat settings"). The chat panel opens beside the messages; on a narrow window it covers them.
3. Each setting gets a control: a slider plus a number box (numbers with both min and max), a checkbox, a dropdown, or a text box / textarea. The current value is shown, whether stored or the default.
4. Checkboxes and dropdowns save at once. Typed values and slider moves save after a short pause or on blur. The reset arrow (shown only when a value is stored) goes back to the default.
5. Send a message. The reply reflects the new values. Under **Execution details** you can see the settings the turn used.

What else to expect:
- If the workflow later stops accepting a stored value (e.g. you lower its max), the chat uses the default and the panel shows an issue such as "Stored value 0.8 is above max 0.5; using default 0.3". The run records it as a warning. The stored value is kept, never rewritten.
- If the workflow declares no settings, the panel says so and links to the workflow editor.
- Changing settings doesn't move the chat up the recent list, and you can do it while a reply streams; the change applies from the next turn.
- Deleting or editing messages never rewinds settings.

## API (for scripts)

- `PATCH /api/sessions/:id` with `{ "settings": { "mood": "tense", "note": null } }` merges the change; `null` resets a key to its default.
- A value of the wrong type, out of range or not among the options, and a key the workflow doesn't declare, are each rejected with `400 CHAT_SETTING_INVALID` and a plain message. Nothing is written in that case.
