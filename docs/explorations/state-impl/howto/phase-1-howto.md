## Phase 1: how to try it (Random, Parse JSON, sinks, per-turn seed)

Start the app with `npm run dev` and open the workflow editor. Make a new workflow, or copy "Default Assistant". Two new nodes are in the **Logic** category: **Random** and **Parse JSON**. None of the examples below need an LLM.

### 1. Dice roll
1. Add **Random** and set **mode** to `integer`, **min** `1`, **max** `20`.
2. Connect its **Value** output to a **Chat Output**, and set the output's template to `You rolled {{input.value}}`.
3. Save, open a chat on this workflow and send any message. Each message gives a new number from 1 to 20.
   - If you set min above max, saving or sending shows a plain error ("Max must be at least min") that points at the node.
   - Leaving min/max blank uses 0..1 in `number` mode and 1..6 in `integer` mode.

### 2. Coin flip that gates a reply
1. Add **Random** with **mode** `chance` and **probability** `0.3`. In this mode the ports change to: inputs Probability and Value; outputs Result, True, False and Roll.
2. Connect **Chat Input → Message** to the Random node's **Value** input.
3. Connect **True** to one Chat Output ("Lucky! {{input.value}}") and **False** to another ("No luck this time").
4. In each turn, only one of the two replies appears. About 30% of turns are "Lucky". The output on the branch not taken is skipped, the same way it is for the Condition node.
   - If you connect a number to the **Probability** input, it replaces the configured value.

### 3. Pick from a list the user sends (Parse JSON + weighted pick)
1. Add **Parse JSON** with **expect** `array`, and connect **Chat Input → Message** to its **Text** input.
2. Add **Random** with **mode** `pick`, and connect Parse JSON **Value** to its **Items** input.
3. Connect Random **Value** to a Chat Output with the template `Picked {{input.value.name}}`.
4. Send a message such as:
   ````
   Choose one:
   ```json
   [{"name":"sword","weight":3},{"name":"shield","weight":1},{"name":"never","weight":0}]
   ```
   ````
   - The answer is "sword" about 3 times in 4 and "shield" otherwise. "never" (weight 0) is never picked.
   - Code fences and the prose around the JSON are ignored.
   - Send `[]` and that reply is skipped, because nothing can be picked. The other outputs still reply.
   - Send `no json here` and the turn fails with "Parse JSON (…): No JSON value found in the text". Open the execution details under the chat: the failing node shows the raw input it received (cut to 500 characters).
   - Send an object where you asked for an array and the turn fails with "Expected an array, got an object".
   - With **expect** `number` or `boolean`, the text must be exactly that value. `7` works, but `Rating: 7` and `about 7/10` fail.
   - Typical real use: put Parse JSON after an LLM that is asked to "answer in JSON".

### 4. What else changed
- **Sinks:** only nodes that some output needs are run. A Random node that leads nowhere is listed as `skipped` in the execution details, as before. Internally, "output" now means any *sink* node type. Chat Output is the only sink for now; later phases add more (for example state writes).
- **Per-turn seed:** each turn records a `seed` in its execution log (`GET /api/executions/:id`). Every Random draw comes from that seed and the node id, and the raw draw is shown as `roll` in the node's output. Nodes never use `Math.random`.

### Known limitations
- The seed is not shown in the chat UI yet, and you can't choose one (no "replay with the same seed").
- The generic config form shows every Random field (min, max, weightField, probability) in all modes. Fields that don't apply to the current mode are ignored. Each field has a hint saying which mode it is for.
- The "not needed by any output" skip reason is an engine event only. The stored log just says `skipped`.
