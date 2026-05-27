# Architecture Overview (v2)

Two views of the same code: **layers** (static structure) and **pipeline** (runtime flow).

The layer rules below are mechanically enforced by `npm run arch:check`
(see `.dependency-cruiser.cjs`). If a diagram edge here doesn't exist in
the rules, the diagram is wrong — fix one or the other.

## Layers

```mermaid
flowchart TD
    subgraph adapters["adapters (I/O)"]
        AO[obsidian]
        AA[anki]
    end

    subgraph application["application (use cases)"]
        APP[sync-vault / sync-note / migration]
    end

    subgraph core["core (pure)"]
        PARSE[parse]
        EDITS[edits]
        RENDER[render]
        SYNC[sync]
        DOMAIN[domain]
    end

    AO --> APP
    AA --> APP
    APP --> PARSE
    APP --> EDITS
    APP --> RENDER
    APP --> SYNC
    PARSE --> DOMAIN
    EDITS --> DOMAIN
    RENDER --> DOMAIN
    SYNC --> DOMAIN

    classDef coreCls fill:#eef,stroke:#88a
    classDef appCls fill:#efe,stroke:#8a8
    classDef adaptCls fill:#fee,stroke:#a88
    class PARSE,EDITS,RENDER,SYNC,DOMAIN coreCls
    class APP appCls
    class AO,AA adaptCls
```

**Rule**: `core` knows nothing about `application` or `adapters`.
`application` knows nothing about `adapters`. Adapters are leaves.

## v2 sync pipeline

```mermaid
flowchart LR
    MD[markdown note] --> P[parse: extract-cards]
    P --> R[render: rewrite media + wikilinks]
    R --> S[sync: build-sync-plan]
    S --> X[adapters/anki: execute-sync-plan]
    S --> E[edits: writeback anchors + frontmatter]
    E --> MD2[updated markdown]
    X --> ANKI[(Anki via AnkiConnect)]
```

Inputs: a note's markdown + frontmatter, plus prior sync state.
Outputs: (a) Anki mutations, (b) writebacks to the note (anchors, card
frontmatter, hashes).
