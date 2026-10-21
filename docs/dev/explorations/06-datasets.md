# 06 — Public datasets usable as enrichment sources

Candidate corpora for the "source" stage of the pipeline: what each is, its licence, size and format,
and which kind of story material it could supply. Facts are as of the fetch date noted in each entry
(this survey was written in October 2026); counts drift, so re-check before relying on them.

See the [index](README.md) for the verification legend. This is not legal advice: licence summaries
are my reading of the pages named, and several pages blocked or did not state terms (marked).

## What this means for the app (short version)

- The sources split by **what they give a story**: *world vocabulary* (ConceptNet, WordNet, Wikidata),
  *encyclopaedic detail* (Wikipedia, Wikivoyage-like), *narrative structure* (motifs, tale types,
  tropes, prompts, plot summaries), *characters' inner lives* (ATOMIC), *concrete objects* (museum
  collections), and *authored random tables* (open RPG material).
- For the "related but not obvious" retrieval in [05](05-relevance-vs-novelty.md), the **graph and
  encyclopaedic** sources supply two-hop neighbours; the **structure** and **table** sources supply
  event seeds for higher intensity rungs.
- **Licence handling:** several valuable sources are ShareAlike (ConceptNet, Wikipedia, CMU summaries)
  or NonCommercial (TV Tropes, some Ironsworn material). Using them locally is generally fine; do **not**
  vendor them into this repository, and keep downloaded data under the gitignored `data/` area.
  Share-alike obligations attach when you *redistribute adapted databases or text*; the effect on a
  generated story that merely uses a fact is a legal question I did not research.

## Summary table

| Source | Licence | Size | Format | Feeds the story with | Verified |
| --- | --- | --- | --- | --- | --- |
| ConceptNet 5.x | CC BY-SA 4.0 | no current count retrieved; README says "over 13 million links" (older figure) | TSV (gz), JSON API | Two-hop associations, facets by relation type | [P] licence; size S |
| WordNet 3.0 | Princeton WordNet licence (permissive, notice required) | 117,659 synsets, 155,287 strings | DB files; many wrappers | Hypernyms/meronyms, sense disambiguation | [V] |
| Wikidata | CC0 for structured data | 123.6M content pages (Oct 2026) | JSON dump, SPARQL | Typed entities: species, places, occupations, artefacts | [P] |
| Wikipedia (en) | CC BY-SA 4.0 (new edits; older under 3.0) + GFDL | 7.25M articles (Oct 2026) | XML dumps | Detail, lore, real-world oddities | [P] |
| Project Gutenberg | Public domain in the US; PG trademark terms | 79,595 eBooks (fetched) | TXT/EPUB/HTML; catalogue | Period prose, folk-tale texts, style samples | [P] |
| Thompson Motif-Index | Status unresolved (see below) | six volumes in print; digital copies via libraries | Print, scans, licensed DB | Structural motif seeds | [S] |
| ATU tale types | Copyrighted (Uther 2004; 2024 ed.); print-centred | thousands of types | Print | Plot skeletons | [S] |
| TV Tropes | CC BY-NC-SA (since 2012), per Wikipedia | very large; counts not retrieved | Wiki HTML; DBTropes RDF (2016) | Tropes, clichés, inversions | [S] |
| WritingPrompts | No licence stated by the release; Reddit-derived | 300K prompt–story pairs | Plain text splits | Premise seeds | [P] size; licence unknown |
| ATOMIC / ATOMIC 2020 | CC BY (dataset cards) | 877K tuples / 1.33M tuples | CSV/TSV | Wants, reactions, effects of events | [S] licence |
| Met Open Access | CC0 | >470,000 artworks (repo page) | CSV | Objects, heirlooms, props | [P] |
| Smithsonian Open Access | CC0 | >11M metadata records (repo page) | Line-delimited JSON | Objects, specimens, archives | [P] |
| Rijksmuseum | Reuse permitted per museum page | ~800,000 object records | LOD APIs, OAI-PMH | Objects, provenance | [S] |
| D&D SRD 5.1 | CC BY 4.0 (also OGL 1.0a) | n/a | PDF/text | Monsters, items, treasure | [P] |
| Ironsworn / Starforged oracles | CC BY 4.0 (SRD subset), CC BY-NC-SA (rest) | n/a | Rulebook text; community JSON | Oracle tables for events, NPCs, places | [S] |
| CMU Movie Summary Corpus | CC BY-SA 3.0 US | 42,306 plot summaries | TSV + tar.gz | Plot shapes, character archetypes | [P] |

## Source notes

### ConceptNet
- Citation: Speer, R., Chin, J., Havasi, C. "ConceptNet 5.5: An Open Multilingual Graph of General
  Knowledge", *AAAI 2017*. https://arxiv.org/abs/1612.03975 [V]. Site: https://conceptnet.io/
- Licence: the site states CC BY-SA 4.0 (read). Per-edge metadata can carry source licences; the
  data-credits file in the repository lists them.
- Size/format: the downloads page describes 5.7.0 as containing all assertions in a gzipped
  tab-separated file (five fields: edge URI, relation, start, end, JSON metadata); it states no counts.
  The GitHub README says "over 13 million links", an older figure. Maintenance status: the repository has
  no releases listed and the site is a Luminoso project; I did not establish how actively it is
  maintained.
- Story use: relation types are *facets* for R3 in [05](05-relevance-vs-novelty.md) (AtLocation,
  UsedFor, HasProperty, Causes, CapableOf, ...). Crowd-sourced, uneven, noisy; filter by edge weight.

### WordNet
- Citation: Princeton University, WordNet 3.0 (2006). Licence page: https://wordnet.princeton.edu/node/10
  [V from search]; statistics: 117,659 synsets (82,115 noun, 13,767 verb, 18,156 adjective, 3,621
  adverb). SPDX id `WordNet`.
- Licence: permission to use, copy, modify and distribute for any purpose, provided the notice and
  disclaimer are kept; Princeton's name may not be used in publicity.
- Story use: a clean taxonomic spine (hypernym/meronym) for "part of a forest" or "kind of tool".
  Coverage is lexical, with little narrative or social content.

### Wikidata and Wikipedia
- Licence: structured data in the main, property, lexeme and entity-schema namespaces is CC0;
  other namespaces are CC BY-SA 4.0 (https://www.wikidata.org/wiki/Wikidata:Licensing [P]).
  Wikipedia text: CC BY-SA 4.0 for new edits, older edits under 3.0 (the Creative Commons announcement
  of the move is https://creativecommons.org/2023/06/29/wikipedia-moves-to-cc-4-0-licenses/ [S]).
- Size (fetched): English Wikipedia 7,252,966 articles (the Wikipedia:Statistics page, "as of October 2026");
  Wikidata 123,629,751 content pages.
- Format: Wikimedia dumps (XML, JSON), SPARQL endpoint, REST APIs.
- Story use: typed queries ("occupations associated with forests", "species of the temperate
  broadleaf biome") for R3; Wikipedia article text for lore and oddities (forest law, charcoal
  burning). Both are the main sources for *real-world specificity*, which LLMs tend to flatten.

### Project Gutenberg
- Licence: works not restricted by US copyright; the site's licence permits nearly any use but
  redistribution of PG-marked copies is subject to the trademark licence, and outside the US local law
  applies (https://www.gutenberg.org/policy/license [V from search]).
- Size: "79,595 free eBooks" (front page, fetched). Format: plain text, HTML, EPUB, machine-readable
  catalogue.
- Story use: period vocabulary, folktale collections (Grimm, Afanasyev, Andrew Lang's fairy books),
  style samples and a corpus for mining unusual collocations. Reagan et al. built their emotional-arc
  study on it ([03](03-drama-management.md)).

### Thompson Motif-Index and ATU
- Citation: Thompson, S. *Motif-Index of Folk-Literature*, 6 vols., 1955–58 (Indiana University Press);
  Uther, H.-J. *The Types of International Folktales* (FF Communications 284–286, 2004; revised
  edition 2024). Folklore Fellows page: https://www.folklorefellows.fi/ffc-284-286-2024-edition/ [S].
- Availability: a search tool, MOMFER, was built to search the Motif-Index with semantic queries
  (University of Utrecht publication record,
  https://research-portal.uu.nl/en/publications/momfer-a-search-engine-of-thompsons-motif-index-of-folk-literatur/
  [S]); Indiana University's library describes a licensed InteLex database; library guides mention a
  HathiTrust scan. For ATU, a library guide states the complete classification is print only.
- **Licence: unresolved.** I could not establish the copyright status of the Motif-Index text or
  any digital edition, and ATU 2004/2024 is a modern copyrighted work. Do not ingest or redistribute
  either until that is checked with a librarian or the rights holder.
- Story use: motif codes with short titles are exactly the "event seed" granularity the pipeline
  wants (e.g. a single-line motif such as a magic object, a prohibition, a test). Safer open
  alternatives for tale material: Gutenberg folk-tale collections and Wikipedia's tale-type articles.

### TV Tropes
- Licence: Wikipedia reports CC BY-SA before July 2012 and CC BY-NC-SA since; the site's own terms
  page returned 403 to my fetch, so the licence is **not confirmed from the source**. Forks (Tropedia,
  All The Tropes) may use different terms.
- Datasets: DBTropes (linked-data wrapper, stale since 2016), PicTropes (film–trope pairs derived from
  DBTropes, arXiv 1809.10959) and TropeScraper (free software; a 2020 analysis,
  https://arxiv.org/abs/2006.05380 [S], reports the live wiki had roughly doubled tropes and
  quadrupled relations versus the 2016 snapshot, and that a full scrape takes days).
- Story use: a vocabulary of narrative devices and their subversions, ideal for the *direction*
  of a twist ("invert the Chekhov's gun"), less for concrete content.
- Caveat: NonCommercial and ShareAlike apply to reuse; scraping policy not checked. Keep out of the
  repo; use locally only.

### WritingPrompts
- Citation: Fan, A., Lewis, M., Dauphin, Y. "Hierarchical Neural Story Generation", *ACL 2018*.
  https://arxiv.org/abs/1805.04833 [V]. Download instructions are in the fairseq stories example
  README ([P]: train/valid/test splits, `curl .../writingPrompts.tar.gz`).
- Size: 300K human-written stories paired with prompts from Reddit r/WritingPrompts (paper).
- Licence: the release README states none; the underlying text is user-generated Reddit content with
  its own terms. Treat as research-use only, unknown redistribution rights.
- Story use: seeds of premises; a corpus for measuring what human premises look like versus LLM ones
  (relevant to the diversity measurements in [01](01-diversity-and-mode-collapse.md)).

### ATOMIC and ATOMIC 2020
- Citations: Sap, M. et al. "ATOMIC: An Atlas of Machine Commonsense for If-Then Reasoning", *AAAI 2019*.
  https://ojs.aaai.org/index.php/AAAI/article/view/4160 [V] (877K inferential tuples over nine
  relation types). Hwang, J. D. et al. "(Comet-)Atomic 2020: On Symbolic and Neural Commonsense Knowledge
  Graphs", *AAAI 2021*. https://arxiv.org/abs/2010.05953 [V] (1.33M tuples, 23 relations).
- Licence: Allen AI's pages (via search) list CC BY for ATOMIC and a dataset card lists cc-by-4.0 for
  ATOMIC 2020; I did not confirm the 2020 licence on Allen AI's own page [S].
- Format: CSV/TSV tuples of the shape event, relation, inference.
- Story use: given an event ("PersonX betrays PersonY"), what each party wants, feels, and does next.
  This gives *motivated consequences* instead of random ones, which is useful as the "fit check"
  data (R6) and for generating complications that follow from character states.

### Museum open-access collections
- Met Museum: `MetObjects.csv`, "more than 470,000 artworks", CC0 1.0, images excluded
  (https://github.com/metmuseum/openaccess [P]). The Met's hub page claims over 492,000 open-access
  images; the figures measure different things.
- Smithsonian: "over 11 million metadata records", line-delimited JSON, CC0-1.0; the GitHub repo is
  archived and points to the AWS Registry of Open Data for current files
  (https://github.com/Smithsonian/OpenAccess [P]).
- Rijksmuseum: metadata for about 800,000 objects; the legacy API is deprecated in favour of Linked
  Open Data APIs (https://data.rijksmuseum.nl [S]); I did not confirm the data licence.
- Not researched: Cleveland Museum of Art, Art Institute of Chicago, Europeana. [unverified]
- Story use: concrete, oddly specific props (a pilgrim's token, a surgeon's kit, a ceremonial comb)
  with real provenance and use. Strong candidates for texture-rung injections because they are
  tangible rather than plot-bearing.

### Open RPG tables
- D&D SRD 5.1: "released under both OGL 1.0a and Creative Commons Attribution 4.0 International"
  (D&D Beyond SRD page, https://www.dndbeyond.com/resources/1781-systems-reference-document-srd [P]).
  Contains monsters, spells, equipment and treasure; I did not catalogue which random tables it holds.
- Ironsworn / Starforged: Tomkin's licensing post says the SRD content (including basic oracle tables
  and the Starforged Reference Guide oracles) is CC BY 4.0 and the full rulebook text is CC BY-NC-SA
  (https://tomkinpress.com/blogs/news/lets-talk-about-ironsworn-licensing [S]). Check which oracle
  is in which category before using any.
- Story use: these are *authored* random tables, designed to be rolled at the table: the closest
  existing precedent for the "random table" source. They already come with sensible granularity and
  sometimes a built-in intensity (a complication versus a flavour roll).

### CMU Movie Summary Corpus
- Citation: Bamman, D., O'Connor, B., Smith, N. A. "Learning Latent Personas of Film Characters",
  *ACL 2013*. Corpus page: https://www.cs.cmu.edu/~ark/personas/ [P]. 42,306 plot summaries from
  Wikipedia with Freebase metadata; CC BY-SA 3.0 US; about 46 MB main archive.
- Story use: plot shapes and character archetype statistics; useful for building an offline "what
  does a typical complication in a thriller look like" prior.

### Considered, not researched
- ROCStories (Mostafazadeh et al. 2016; access via a request form, licence unverified).
- Wikivoyage / Wiktionary / OpenStreetMap place-type tags; FrameNet (page fetch returned no usable
  text); GBIF and iNaturalist species-by-habitat data (per-dataset licences vary); the SCP Foundation
  wiki (reported CC BY-SA, not verified). Listed so they are not forgotten.

## Which sources fit which rung of the intensity ladder (suggestion)

| Rung | Needs | Good fits |
| --- | --- | --- |
| Texture (sensory, background) | Concrete nouns, specific details | Museum objects, Wikipedia oddities, WordNet parts |
| Hint (a thread to notice) | Plausible local facts | ConceptNet/Wikidata two-hop, Gutenberg folklore details |
| Complication | Motivated consequence | ATOMIC, Ironsworn-style oracles, SRD tables |
| Twist / mandated beat | Structural device | Motif/ATU-like seeds (once licensing is settled), TV Tropes inversions, WritingPrompts premises |
