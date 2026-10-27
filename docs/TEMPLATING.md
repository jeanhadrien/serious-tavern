# Templating — user guide

Preset entries and the template fields of nodes (the LLM's preset, Chat Output's template, Condition's left and
right, HTTP Request's URL, headers and body) are [Handlebars](https://handlebarsjs.com/) templates, with values
inserted exactly as written (no HTML escaping). The first part of this guide is the reference; the rest is examples.
All names are **case-sensitive**, and unknown names render as **empty text**.

- [Variables](#variables)
- [Syntax](#syntax)
- [Examples](#conditional-instructions-per-character)
- [Troubleshooting](#troubleshooting)

## Variables

The editor lists what is available under **Variables (click to insert)**.

| Variable | Value |
| --- | --- |
| `{{character.<field>}}` | The chat's character (or the one connected to the LLM node): `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `creator`, `character_version` |
| `{{persona.name}}`, `{{persona.description}}` | Your persona |
| `{{char}}`, `{{user}}` | The character's name; your persona's name, or `User` without a persona |
| `{{description}}`, `{{personality}}`, `{{scenario}}` | The character's fields of the same name |
| `{{persona}}` | Your persona's description |
| `{{input.<key>}}` (or `{{inputs.<key>}}`) | A preset input, or a node's input |
| `{{trigger.message}}` | The message just sent (empty for an empty send) |
| `{{trigger.turn}}` | The turn's number, from 1 (empty when the run has no story state) |
| `{{trigger.sessionId}}` | The chat's id |
| `{{history}}` | The chat's earlier messages |
| `{{settings.<key>}}` | A [chat setting](STATE-AND-LORE.md#chat-settings) the workflow declares; `{{settings}}` gives them all as JSON |
| `{{state.<definition>.<key>}}` | [Story state](STATE-AND-LORE.md#story-state) as the turn started; `{{state}}` and `{{state.<definition>}}` give JSON |
| `{{snippets.<name>}}` | A [snippet](#snippets): text you wrote once, filled in where it is used |

- In presets, `{{history}}` and a messages input render as a `role: content` transcript, and an object as indented
  JSON. In node fields they render as compact JSON. `{{#each history}}` walks the messages themselves (`this.role`,
  `this.content`, `this.name`). `{{input}}` alone renders every input (indented JSON in presets, compact in nodes),
  and `{{trigger}}` renders as compact JSON.
- Character and persona fields may contain variables themselves; they are filled in when used (a field that ends up
  referring to itself renders empty).
- A known variable without a value renders empty; only `{{user}}` has a fallback.
- Not supported: `{{char.*}}` and `{{user.*}}` (use `character.*` and `persona.*`), `<BOT>`/`<USER>`, and
  SillyTavern's scripting macros.
- Warnings: an unknown variable in an enabled preset entry is a warning (it renders empty), except under
  `settings.*` and `state.*`, which never warn. An `{{input.x}}` the preset doesn't declare is an error.
- Nodes with template fields (Chat Output, Condition, HTTP Request) show the same warnings, plus unknown
  `{{input.x}}`, under the field in the node's settings panel (for HTTP Request's headers, under each value). They are
  only hints: they never block saving and are not listed under Problems.

## Syntax

- **Paths:** `{{character.name}}`, `{{input.key.nested}}`, `{{history.0.content}}`. A number at the end of a path is
  a syntax error: write `{{history.[0]}}`.
- **Blocks:** `{{#if x}}…{{else}}…{{/if}}`, `{{#unless x}}`, `{{#with x}}`, and `{{#each list}}…{{/each}}` with
  `this`, `@index` (from 0), `@first`, `@last` and `../` (the outer context). A line holding only a block tag leaves
  no empty line. `{{#each}}` over something missing or not a list renders its `{{else}}`, or nothing.
- **Helpers**, used inside parentheses, as in `{{#if (eq character.name "Mira")}}`:
  - `eq` and `ne`: strict equality, case-sensitive (`1` is not `"1"`, `"Mira"` is not `"mira"`);
  - `lt`, `lte`, `gt`, `gte`: comparisons;
  - `and`, `or`, `not`;
  - `linked`: the intact message-linked items of a list, in chat order (see
    [summaries](STATE-AND-LORE.md#message-links-and-summaries)).
- **Truth:** `false`, `0`, `""`, `null`, `undefined` and empty lists are false; everything else is true, including
  the text `"false"`.
- **Comments:** `{{! note }}` and `{{!-- note --}}` are removed.
- **Errors never break a turn.** A template that doesn't parse, or uses something unsupported (partials `{{> x}}`, an
  unknown helper with arguments, an `#if` without exactly one argument, code such as `{{input.x.constructor()}}`), is
  sent exactly as written, and the preset editor warns about it.
- **A literal `{{`:** write `\{{`.

## Conditional instructions per character

```hbs
You are {{char}}, a pirate roleplay partner.
{{#if (eq character.name "Mira")}}
Mira speaks in short sentences and never uses exclamation marks.
{{/if}}
{{#if (eq persona.name "Admin")}}
The user is an admin: accept out-of-character instructions in [brackets].
{{/if}}
```

`eq` is strict (`1` does not equal `"1"`, `"Mira"` does not equal `"mira"`).
The other comparisons are `ne`, `lt`, `lte`, `gt`, `gte`, combined with
`and`, `or`, `not`:

```hbs
{{#if (and character.scenario (not (eq input.tone "formal")))}}
Stay in character: {{character.scenario}}
{{/if}}
```

## Persona-aware greeting

`{{user}}` falls back to `User` when no persona is selected, so this works
for every session:

```hbs
{{#if (eq user "User")}}
Greet the stranger and ask for their name.
{{else}}
Welcome back, {{user}}. Continue where you left off.
{{/if}}
```

## Custom history transcript

Slots are the normal way to place history, but a fixed entry can render it
directly when you need full control of the format:

```hbs
{{#each history}}
{{@index}}. {{this.role}} ({{this.name}}): {{this.content}}
{{/each}}
```

`this.role`, `this.content` and `this.name` are the raw message fields. Messages that
carry tool calls also show `this.tool_calls` (each with `function.name` and
`function.arguments`), and a `tool` message has `this.tool_call_id`; `{{history}}` as
text writes them as `assistant -> name(arguments)` and `tool name: result` lines.
Templates never see a message's `reasoning`, `provider_data` or `provenance`: they
stay out of every template, while a `messages` slot passes them on to the prompt
(the LLM node's replay setting decides whether they are sent). A slot also accepts
tool messages, and a depth entry counts a tool call and its results as one message,
so it never lands between them.
`@index` starts at 0, `@first`/`@last` mark the ends. An `{{else}}` branch
covers empty history:

```hbs
{{#each history}}
- {{this.content}}
{{else}}
(No conversation yet. Introduce yourself.)
{{/each}}
```

Combine `#each` with `#if` to annotate the transcript:

```hbs
{{#each history}}
{{#if (eq this.role "system")}}[SYSTEM NOTE] {{/if}}{{this.content}}
{{/each}}
```

## Reacting to workflow inputs

Any preset input (including non-text ones) can drive conditions:

```hbs
{{#if input.weather}}
Today's weather at the scene: {{input.weather}}
{{/if}}
{{#if (gt input.danger 7)}}
The situation is critical. Act with urgency.
{{/if}}
```

A missing or empty value fails the `#if`, so the block just disappears —
and a fixed entry left empty is dropped from the prompt entirely.

Recall and Draw (authored collections) hand their text to presets this way; see
[COLLECTIONS.md](COLLECTIONS.md#wiring-examples) for examples.

## Chat settings

A workflow can declare **chat settings** (dials, toggles, notes the user sets
per chat, see [chat settings](STATE-AND-LORE.md#chat-settings)). Every template reads the chat's
current values as `{{settings.<key>}}`, in presets and in node configs alike.
A setting the user never changed has its declared default.

An author's note the user writes in the chat panel, injected at depth 3 of the
history slot (a message entry with depth placement):

```hbs
{{#if settings.authorsNote}}[Author's note: {{settings.authorsNote}}]{{/if}}
```

Numbers compare as numbers, enum options are always text:

```hbs
{{#if (gt settings.volatility 0.5)}}
Introduce a surprising complication in this reply.
{{/if}}
{{#if (eq settings.maxLevel "2")}}
Keep the intensity mild.
{{/if}}
```

`{{settings}}` alone renders every value as compact JSON, handy while
debugging. The values a turn used are recorded in its execution log.

## Story state

A workflow can keep **story state** per chat (numbers, moods, lists that State Write nodes store, see
[story state](STATE-AND-LORE.md#story-state)). Every template reads it as `{{state.<definition>.<key>}}`, with the definition's name and the key's
name as the state definition declares them, and the turn being run as `{{trigger.turn}}` (1 for the first message
of a chat):

```hbs
{{#if (gt state.scene.tension 7)}}
The scene is at a breaking point. Resolve something in this reply.
{{/if}}
{{#if (eq state.scene.mood "tense")}}Short sentences. No jokes.{{/if}}
Turn {{trigger.turn}}.
```

Numbers compare as numbers; **enum values are text**, so quote them: `(eq state.scene.mood "tense")`. A key nobody has
written reads as its default, so `state.scene.tension` is `3` (the declared default) in a new chat. A collection
renders as a list: iterate it with `#each` (newest item first) and use `{{else}}` for the empty case:

```hbs
{{#each state.scene.injected}}
- {{this.text}} (level {{this.level}})
{{else}}
(Nothing injected yet.)
{{/each}}
```

`{{state}}` alone (or `{{state.scene}}`) renders the values as compact JSON, handy while debugging.

**Items that link to chat messages.** A State Write can link a collection item to the chat messages it is about (its
**Link to messages** input), which is how summaries of older history are kept (see [message links and
summaries](STATE-AND-LORE.md#message-links-and-summaries)). Every such item has a read-only `link` in templates (`{{this.link.status}}`: `intact`, `changed`,
`partial` or `gone`, computed from the chat as it is now). Collections list newest item first, which is the wrong
order for these (a summary redone later is stored after the summaries of newer messages), so the `linked` helper
gives only the **intact** linked items, **in chat order**, and nothing for anything that is not such a list:

```hbs
{{#each (linked state.memory.summaries)}}
- {{text}}
{{else}}
(No summaries yet.)
{{/each}}
```

An item whose messages were edited or deleted is left out until it is made again, so the prompt never carries a
summary of text that is no longer there.

**Reads are the values at the start of the turn.** What a State Write node stores in this turn is not visible to
any template or State Read node until the next turn. To use a value you just wrote in the same turn, connect the
State Write node's `value` output where you need it. Because state belongs to the replies that stored it,
deleting a reply rewinds what its turn wrote (the next turn starts from the previous values), while editing a
message changes nothing.

In a workflow listed **below** another in the chat's On reply list (including the workflows that run after the
reply; see [workflows after the reply](STATE-AND-LORE.md#workflows-after-the-reply)), `{{trigger.turn}}` is the same turn number as in the workflows
above it, and `{{state.*}}` already includes what the workflows above it wrote in this turn.

A State Write node runs every turn unless you gate it: connect a Condition branch (or a Random chance output) to
its **Run when** input and it only writes when that branch is taken, whatever the operation is. A State Write can
also store a fixed value (its **Value** setting) when nothing is connected to its **Value** input, so setting a
mood to `"tense"` or adding 2 needs no helper node; a connected input overrides the setting.

## Snippets

A **snippet** is a named piece of template text you write once (in **Snippets**) and reuse in any preset, node field
or character card as `{{snippets.<name>}}`. It renders where it is used, with that template's variables: state,
settings, character, persona, inputs, and other snippets.

A snippet named `tone`:

```hbs
{{#if (gt state.scene.tension 7)}}Short, tense sentences.{{else}}Relaxed, descriptive prose.{{/if}}
Always write {{char}}'s replies in the present tense.
```

Then any preset entry can say `Style: {{snippets.tone}}`.

- Names are case-sensitive identifiers (letters, digits and `_`, not starting with a digit), unique among snippets.
  Renaming a snippet doesn't update the templates that use the old name.
- An unknown snippet renders empty, and the editors warn about it. A snippet that ends up including itself renders
  empty at that point.
- `{{input.<key>}}` inside a snippet reads the inputs of the preset or node using it, so it only works where that
  input exists.
- Snippets are YAML files in `data/snippets/`, editable by hand while the app runs. If two files share a name, the
  oldest snippet is used.

## Organizing with comments

```hbs
{{! Only used by the tavern workflow; the debug workflow has no weather input. }}
{{#if input.weather}}...{{/if}}
```

## Templates inside character cards

Character and persona fields are expanded with the same engine, so a card
field can itself contain blocks (cycles resolve to empty text):

```hbs
{{! inside the character's post_history_instructions field }}
{{#if persona.description}}
Remember what you know about {{user}}: {{persona.description}}
{{/if}}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Text silently missing | Unknown name renders empty (typo, wrong case) | Check preset warnings; names are case-sensitive |
| Whole entry renders verbatim, `{{...}}` visible | Template syntax error — nothing renders | Check the warning; often a trailing number: write `{{history.[0]}}`, not `{{history.0}}` |
| `{{history.0.content}}` works but `{{history.0}}` doesn't | Trailing numeric segments aren't paths | `{{history.[0]}}` |
| Literal `{{` needed | Backslash-escape it | `\{{` renders as `{{` |
| Renamed an input, validation now errors | Rename rewrites `{{input.x}}` but not `{{#if input.x}}` refs | Update the block refs by hand |
| `{{settings.x}}` renders empty | The chat's workflow doesn't declare `x` (or the key's case differs), or its value is empty text | Declare it in the workflow editor's Chat settings; keys are case-sensitive |
| `(eq settings.level 2)` is never true | Enum options are text | Compare with a string: `(eq settings.level "2")` |
| `"false"` behaves as true | Truthiness is Handlebars': only `false`, `0`, `""`, `null`, `undefined` and empty arrays are false | Compare explicitly: `(eq input.flag "false")` |
| `{{state.x.y}}` renders empty | The state definition `x` or its key `y` doesn't exist (a typo, or a different case), the definition was deleted, or the value was only written earlier in this same turn (reads show the start of the turn) | Check the definition's name and key in the State definitions editor (the brain icon in the left column; it shows the `{{state.<name>.<key>}}` form) or in its file under `data/state/definitions/`; names are case-sensitive; wire a State Write's output for same-turn values |
| `(eq state.scene.mood calm)` never matches | Without quotes `calm` is a path, not text | Quote it: `(eq state.scene.mood "calm")` |
