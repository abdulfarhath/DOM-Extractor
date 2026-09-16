/**
 * JSDoc typedefs for every record Flowprint stores or exports.
 * Contract: docs/03-output-schema.md plus docs/10-addendum.md. Nothing here is
 * executed; the `export {}` makes the file a module so the typedefs can be
 * imported with `import('../shared/schema.js').StateRecord` from any context,
 * including the classic-script content files.
 */

/**
 * How a control's label was found. Order is also strength order —
 * `container`, `sibling`, `placeholder` and `none` get flagged in the summary.
 * @typedef {'for'|'wrap'|'aria-labelledby'|'aria-label'|'container'|'sibling'|'placeholder'|'none'} LabelSource
 */

/** @typedef {'stable'|'likely'|'fragile'} SelectorStability */

/**
 * @typedef {Object} SelectorSet
 * @property {string} primary
 * @property {string[]} fallbacks
 * @property {string[]} shadowPath   host selectors to traverse first; empty for light DOM (A1)
 * @property {SelectorStability} stability
 * @property {boolean} unique        primary matches exactly one element in its document root
 * @property {boolean|null} uniqueInForm   same check inside the closest form / [role=form]; null without one
 * @property {string} notes
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} BoundingBox */

/** @typedef {{ v: string, t: string }} SelectOption */

/**
 * A6 — how a value gets into this control.
 * @typedef {Object} EntryHint
 * @property {'typed'|'widget'|'unknown'} mode
 * @property {string} evidence
 * @property {'datepicker'|'listbox'|'autocomplete'|'mask'|null} widgetKind
 * @property {string|null} mask
 */

/**
 * A6 — file inputs: shape only, never the selection.
 * @typedef {Object} FileHint
 * @property {string|null} accept
 * @property {boolean} multiple
 * @property {string|null} capture
 */

/**
 * A single form control or ARIA widget. `value` is already redacted, and is
 * absent altogether on credential-shaped controls (docs/11 F2): they keep
 * every structural field, carry `redactedEntirely: true`, and never a length.
 * @typedef {Object} ControlRecord
 * @property {number} index
 * @property {string} tag
 * @property {string} type
 * @property {string|null} role
 * @property {string} key   identity used in signatures, edges and the flow map
 * @property {string} id
 * @property {string} name
 * @property {string} formControlName
 * @property {Record<string, string>} dataAttrs   every data-* attribute, values capped
 * @property {string} label
 * @property {LabelSource} labelSource
 * @property {string} placeholder
 * @property {string} ariaLabel
 * @property {string} ariaDescribedByText
 * @property {string} title
 * @property {boolean} required
 * @property {number|null} maxLength
 * @property {number|null} minLength
 * @property {string|null} pattern
 * @property {string|null} inputMode
 * @property {string|null} step
 * @property {string|null} min
 * @property {string|null} max
 * @property {boolean} disabled
 * @property {boolean} readOnly
 * @property {boolean} visible
 * @property {BoundingBox} boundingBox
 * @property {string} classes
 * @property {string} [value]   `<n chars>` or ''; absent when redactedEntirely
 * @property {boolean} redactedEntirely   content never recorded; a human fills this control
 * @property {string|null} group
 * @property {number|null} optionCount
 * @property {SelectOption[]|null} options
 * @property {boolean|null} checked
 * @property {EntryHint} entry
 * @property {FileHint|null} file
 * @property {SelectorSet} selectors
 */

/** Kept as an alias so older call sites read the same; every control is a full record now. */
/** @typedef {ControlRecord} AnyControlRecord */

/**
 * @typedef {Object} ButtonRecord
 * @property {string} text
 * @property {string} id
 * @property {string} classes
 * @property {string} type
 * @property {boolean} disabled
 * @property {boolean} visible
 * @property {boolean} danger
 * @property {string} selector
 */

/** @typedef {{ text: string, active: boolean }} StepRecord */

/** @typedef {{ w: number, h: number, dpr: number }} Viewport */

/**
 * @typedef {Object} FrameworkInfo
 * @property {'angular'|'react'|'vue'|'svelte'|'jquery'|'plain'} framework
 * @property {string|null} version
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} webComponents   custom elements registered / shadow roots present
 */

/**
 * Crude logged-in signal (Q7). Language-independent signals first — a
 * password field, autocomplete tokens, login/logout path segments — and
 * English affordance text only as a low-confidence last resort.
 * @typedef {{ loggedIn: boolean|null, evidence: string, confidence: 'high'|'medium'|'low' }} AuthHints
 */

/**
 * @typedef {Object} TableSlot
 * @property {string} selector   relative to the row
 * @property {string} sample     redacted
 */

/**
 * @typedef {Object} TablePattern
 * @property {string} containerSelector
 * @property {string[]} shadowPath
 * @property {string[]} headers
 * @property {number} rowCount
 * @property {string} rowSelector
 * @property {TableSlot[]} sampleRow
 */

/**
 * @typedef {Object} RepeatSlot
 * @property {string} name
 * @property {string} selector   relative to the item
 * @property {'text'|'link'|'image'} kind
 * @property {string} sample     redacted
 * @property {boolean} [download]
 */

/**
 * @typedef {Object} RepeatPattern
 * @property {string} containerSelector
 * @property {string[]} shadowPath
 * @property {string} itemSelector
 * @property {number} itemCount
 * @property {RepeatSlot[]} slots
 */

/**
 * @typedef {Object} PaginationPattern
 * @property {string} containerSelector
 * @property {string|null} next
 * @property {string|null} prev
 * @property {string|null} pageIndicator
 * @property {'numbered'|'next-prev'|'load-more'|'unknown'} style
 */

/**
 * @typedef {Object} DownloadPattern
 * @property {string} selector
 * @property {string|null} extension
 * @property {'direct'|'script'} href
 * @property {boolean} downloadAttr
 */

/**
 * @typedef {Object} ListPatterns
 * @property {TablePattern[]} tables
 * @property {RepeatPattern[]} repeats
 * @property {PaginationPattern[]} pagination
 * @property {DownloadPattern[]} downloads
 */

/**
 * A1 — a region the capture could not see into.
 * @typedef {Object} OpaqueRegion
 * @property {string} tag
 * @property {string} selector
 * @property {true} opaque
 * @property {string} reason
 */

/**
 * What the content script sends. The worker assigns id, seq, refs and tab
 * identity to make a StateRecord.
 * @typedef {Object} StateDraft
 * @property {string} capturedAt
 * @property {string} trigger
 * @property {string} triggerAt
 * @property {string[]} triggers    every trigger in the burst, repeats collapsed
 * @property {string} origin
 * @property {string} url
 * @property {string} pathname
 * @property {string} title
 * @property {string} lang
 * @property {boolean} inIframe
 * @property {string|null} frameSrc
 * @property {Viewport} viewport
 * @property {{ x: number, y: number }} scroll
 * @property {FrameworkInfo} framework
 * @property {string} signature
 * @property {string[]} headings
 * @property {StepRecord[]} steps
 * @property {ButtonRecord[]} buttons
 * @property {string[]} errors
 * @property {string[]} notices
 * @property {AuthHints} authHints
 * @property {number} controlCount
 * @property {AnyControlRecord[]} controls
 * @property {ListPatterns} lists
 * @property {boolean} usesShadowDom
 * @property {boolean} orderApproximate   Q5: control `index` interleaves shadow content after light DOM
 * @property {OpaqueRegion[]} opaqueRegions
 * @property {boolean} captureDegraded   A2 breaker was active when this state was built
 */

/**
 * @typedef {StateDraft & {
 *   id: string,
 *   seq: number,
 *   tabId: number,
 *   frameId: number,
 *   domRef: string|null,
 *   screenshotRef: string|null,
 *   duplicateOf: string|null,
 *   blockedFrames: string[],
 *   netRefs: string[],
 * }} StateRecord
 */

/** @typedef {{ name: string, value: string }} HeaderPair */

/**
 * What the MAIN-world hook posts, before scrubbing and id assignment.
 * @typedef {Object} NetDraft
 * @property {'fetch'|'xhr'} kind
 * @property {string} method
 * @property {string} url
 * @property {number} status
 * @property {string} statusText
 * @property {HeaderPair[]} requestHeaders
 * @property {string|null} requestBody
 * @property {HeaderPair[]} responseHeaders
 * @property {string|null} responseBody
 * @property {string} mimeType
 * @property {string} startedAt
 * @property {number} durationMs
 * @property {string} pageUrl
 * @property {string|null} error
 */

/**
 * @typedef {NetDraft & {
 *   id: string,
 *   seq: number,
 *   tabId: number,
 *   frameId: number,
 *   stateIdAtTime: string|null,
 *   stateIdInferred: boolean,
 * }} NetEntry
 */

/** @typedef {{ key: string, before: SelectOption[]|null, after: SelectOption[]|null }} OptionsChange */
/** @typedef {{ selector: string, before: number, after: number }} ListCountChange */

/**
 * Edge in the state graph.
 * @typedef {Object} Transition
 * @property {string} from
 * @property {string} to
 * @property {string} trigger
 * @property {boolean} urlChanged
 * @property {string[]} fieldsAdded
 * @property {string[]} fieldsRemoved
 * @property {OptionsChange[]} optionsChanged
 * @property {ListCountChange[]} listCountsChanged
 * @property {string[]} netCallsBetween
 * @property {string[]} errorsAppeared
 */

/**
 * @typedef {Object} Dependency
 * @property {string} sourceKey
 * @property {string[]} targetKeys
 * @property {boolean} viaNetwork
 * @property {string} [endpoint]
 * @property {'high'|'medium'} confidence
 * @property {string} stateId
 */

/** @typedef {{ type: 'paused'|'resumed'|'cleared', at: string }} TimelineEvent */

/**
 * A5 — which degradations have been applied this session.
 * @typedef {Object} Degraded
 * @property {boolean} screenshots
 * @property {boolean} snapshots
 * @property {boolean} netTrimmed
 * @property {boolean} statesRefused
 */

/**
 * Session meta — the only key the panel polls.
 * @typedef {Object} SessionMeta
 * @property {string} sessionStartedAt
 * @property {boolean} recording
 * @property {boolean} screenshots
 * @property {string[]} dangerWords
 * @property {string[]} packs   enabled redaction packs
 * @property {number} seq
 * @property {number} netSeq
 * @property {number} stateCount
 * @property {number} netCount
 * @property {number} domCount
 * @property {number} screenshotCount
 * @property {number} listPatternCount
 * @property {TimelineEvent[]} timeline
 * @property {Degraded} degraded
 * @property {Record<string, string[]>} blockedFrames   tabId → frame origins that hit the gate (A3)
 * @property {Record<string, number>} throttledUntil    origin → epoch ms while the A2 breaker is tripped
 */

/**
 * Per tab:frame bookkeeping so transitions and stateIdAtTime survive worker restarts.
 * @typedef {Object} TabInfo
 * @property {string|null} lastStateId
 * @property {string|null} lastSignature
 * @property {string|null} lastErrorsKey
 * @property {string|null} lastAt
 * @property {string|null} origin
 */

/** @typedef {Record<string, TabInfo>} TabMap */

/** @typedef {{ stateId: string, windowId: number, at: number }} ScreenshotJob */

/**
 * @typedef {Object} ExportManifest
 * @property {string} tool
 * @property {string} version
 * @property {string} exportedAt
 * @property {string} sessionStartedAt
 * @property {string[]} origins
 * @property {{ origin: string, framework: string, version: string|null }[]} frameworks
 * @property {{ states: number, domSnapshots: number, screenshots: number, netEntries: number, listPatterns: number, transitions: number, dependencies: number }} counts
 * @property {{ packs: string[], fieldValues: string, domValues: string, bodies: string }} redaction
 * @property {string[]} blockedFrames
 * @property {Degraded} degraded
 * @property {string[]} warnings
 * @property {string} harNote
 */

/**
 * @typedef {Object} FlowMapPage
 * @property {string} stateId
 * @property {string} pathname
 * @property {string} title
 * @property {string} reachedBy
 */

/**
 * @typedef {Object} FlowMapControl
 * @property {string} key
 * @property {string[]} altKeys
 * @property {string[]} seenOnStates
 * @property {string} label
 * @property {LabelSource} labelSource
 * @property {string} type
 * @property {boolean} required
 * @property {number|null} maxLength
 * @property {string|null} pattern
 * @property {{ primary: string, fallbacks: string[], shadowPath: string[], stability: SelectorStability }} selectors
 * @property {SelectOption[]|null} options
 * @property {EntryHint|null} entry
 * @property {string[]} dependsOn
 * @property {string[]} affects
 * @property {string[]} collidesWith   A7
 * @property {boolean} redactedEntirely   human-only; never bind a data source (docs/11)
 * @property {null} sourceField
 * @property {string} notes
 */

/**
 * @typedef {Object} FlowMapList
 * @property {'table'|'repeat'|'pagination'|'download'} kind
 * @property {string} selector
 * @property {string[]} seenOnStates
 * @property {TablePattern|RepeatPattern|PaginationPattern|DownloadPattern} pattern
 */

/**
 * @typedef {Object} FlowMap
 * @property {string} generatedAt
 * @property {string} origin
 * @property {string} framework
 * @property {FlowMapPage[]} pages
 * @property {FlowMapControl[]} controls
 * @property {FlowMapList[]} lists
 * @property {Dependency[]} dependencies
 * @property {Transition[]} transitions
 * @property {TimelineEvent[]} timeline
 */

/**
 * @typedef {Object} SelectorsFile
 * @property {Record<string, string>} selectors
 * @property {Record<string, string[]>} fallbacks
 * @property {Record<string, string[]>} shadowPaths
 */

/**
 * Snapshot the panel polls for. Small on purpose.
 * @typedef {Object} Stats
 * @property {number} states
 * @property {number} net
 * @property {number} lists
 * @property {number} screenshots
 * @property {boolean} recording
 * @property {boolean} screenshotsEnabled
 * @property {string[]} dangerWords
 * @property {string[]} packs
 * @property {string[]} origins
 * @property {string} sessionStartedAt
 * @property {Degraded} degraded
 * @property {boolean} throttled
 * @property {ExportProgress} exportProgress
 */

/**
 * @typedef {Object} ExportProgress
 * @property {boolean} active
 * @property {'idle'|'packing'|'downloading'} phase
 * @property {number} current   entries added to the zip so far
 * @property {number} total     entries planned
 * @property {string|null} error
 * @property {string|null} warning   non-fatal advice, e.g. a Save dialog waiting (Q15)
 * @property {string|null} folder    the zip file name once known
 */

/**
 * One row of the side panel's live feed.
 * @typedef {Object} PanelRow
 * @property {string} id
 * @property {number} seq
 * @property {string} title
 * @property {string} pathname
 * @property {string} trigger
 * @property {string} capturedAt
 * @property {number} controlCount
 * @property {number} errorCount
 * @property {number} listCount
 * @property {boolean} newControls
 * @property {boolean} duplicate
 * @property {boolean} inIframe
 * @property {boolean} degraded
 * @property {string[]} headings
 * @property {StepRecord[]} steps
 * @property {string[]} controlLabels
 * @property {string[]} listSummary
 */

/**
 * What the panel gets for the active tab's origin.
 * @typedef {Object} OriginInfo
 * @property {string} origin
 * @property {boolean} consented
 * @property {string[]} otherOrigins
 * @property {string[]} blockedFrames
 */

export {};
