/**
 * JSDoc typedefs for every record the extension stores or exports.
 * Contract: docs/03-output-schema.md. Nothing here is executed; the `export {}`
 * makes the file a module so the typedefs can be imported with
 * `import('../shared/schema.js').StateRecord` from any context, including the
 * classic-script content files.
 */

/**
 * How a field's label was found. Order here is also strength order —
 * `container`, `sibling`, `placeholder` and `none` get flagged in SUMMARY.md.
 * @typedef {'for'|'wrap'|'aria-labelledby'|'aria-label'|'container'|'sibling'|'placeholder'|'none'} LabelSource
 */

/** @typedef {'stable'|'likely'|'fragile'} SelectorStability */

/**
 * @typedef {Object} SelectorSet
 * @property {string} primary
 * @property {string[]} fallbacks
 * @property {SelectorStability} stability
 * @property {boolean} unique   primary matches exactly one element in the document at capture time
 * @property {boolean|null} uniqueInForm   same check scoped to the enclosing <form>; null when there is none (Q5)
 * @property {string} notes
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} BoundingBox */

/** @typedef {{ v: string, t: string }} SelectOption */

/**
 * A single form control. Values are already redacted (`<n chars>`) by the time
 * this object exists — see docs/05 rule 1.
 * @typedef {Object} FieldRecord
 * @property {number} index
 * @property {string} tag
 * @property {string} type
 * @property {string} id
 * @property {string} name
 * @property {string} formControlName
 * @property {string} label
 * @property {LabelSource} labelSource
 * @property {string} placeholder
 * @property {string} ariaLabel
 * @property {string} title
 * @property {boolean} required
 * @property {number|null} maxLength
 * @property {number|null} minLength
 * @property {string|null} pattern
 * @property {string|null} inputMode
 * @property {boolean} disabled
 * @property {boolean} readOnly
 * @property {boolean} visible
 * @property {BoundingBox} boundingBox
 * @property {string} classes
 * @property {string} value   always `<n chars>` or empty string
 * @property {string|null} group   radio/checkbox shared name
 * @property {number|null} optionCount
 * @property {SelectOption[]|null} options
 * @property {boolean|null} checked
 * @property {SelectorSet} selectors
 */

/**
 * A credential-shaped control (docs/05 rule 2). Only its existence is recorded.
 * @typedef {Object} RedactedFieldRecord
 * @property {number} index
 * @property {string} tag
 * @property {string} type
 * @property {string} label
 * @property {LabelSource} labelSource
 * @property {true} redactedEntirely
 */

/** @typedef {FieldRecord|RedactedFieldRecord} AnyFieldRecord */

/**
 * @typedef {Object} ButtonRecord
 * @property {string} text
 * @property {string} id
 * @property {string} classes
 * @property {boolean} disabled
 * @property {boolean} visible
 * @property {boolean} danger   text matches submit|pay|confirm|delete|final
 */

/** @typedef {{ text: string, active: boolean }} StepRecord */

/** @typedef {{ w: number, h: number, dpr: number }} Viewport */

/**
 * What the content script sends. The service worker assigns `id`, `seq`, refs
 * and tab identity to turn it into a StateRecord.
 * @typedef {Object} StateDraft
 * @property {string} capturedAt
 * @property {string} trigger   first user-originated trigger in the debounce burst
 * @property {string} triggerTimestamp
 * @property {string[]} triggers   every trigger in the burst, consecutive repeats collapsed (Q11)
 * @property {string} url
 * @property {string} pathname
 * @property {string} title
 * @property {boolean} inIframe
 * @property {string|null} frameSrc
 * @property {Viewport} viewport
 * @property {{ x: number, y: number }} scroll   window scroll offset; boundingBoxes are viewport-relative (Q4)
 * @property {string} signature
 * @property {string[]} headings
 * @property {StepRecord[]} steps
 * @property {ButtonRecord[]} buttons
 * @property {string[]} errors
 * @property {string[]} notices
 * @property {number} fieldCount
 * @property {AnyFieldRecord[]} fields
 */

/**
 * One captured page state.
 * @typedef {StateDraft & {
 *   id: string,
 *   seq: number,
 *   tabId: number,
 *   frameId: number,
 *   domRef: string|null,
 *   screenshotRef: string|null,
 *   screenshotOf: 'page'|'parent-frame'|null,
 *   duplicateOf: string|null,
 *   netRefs: string[],
 * }} StateRecord
 *
 * `screenshotOf` is `parent-frame` for iframe states: captureVisibleTab grabs
 * the whole tab, so the image shows the parent page (Q1). `duplicateOf` is set
 * on a manual capture whose signature and errors match the previous state (Q10).
 */

/** @typedef {{ name: string, value: string }} HeaderPair */

/**
 * What the MAIN-world hook posts, before the content script scrubs bodies and
 * the service worker assigns an id.
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
 * @property {string|null} error   set when the call threw (network failure)
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
 *
 * `stateIdInferred` is true when the entry came from a frame with no state of
 * its own and was attributed to the tab's top-frame state instead (Q12).
 */

/** @typedef {{ fieldId: string, before: SelectOption[]|null, after: SelectOption[]|null }} OptionsChange */

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
 * @property {string[]} netCallsBetween
 * @property {string[]} errorsAppeared
 */

/**
 * @typedef {Object} Dependency
 * @property {string} sourceField
 * @property {string[]} targetFields
 * @property {boolean} viaNetwork
 * @property {string} [endpoint]
 * @property {'high'|'medium'} confidence
 * @property {string} [stateId]   state whose capture surfaced it
 */

/**
 * Session meta — the only key the panel polls.
 * @typedef {Object} SessionMeta
 * @property {string} sessionStartedAt
 * @property {boolean} recording
 * @property {boolean} screenshots
 * @property {number} seq         last state sequence number handed out
 * @property {number} netSeq      last net sequence number handed out
 * @property {number} stateCount
 * @property {number} netCount
 * @property {number} domCount
 * @property {number} screenshotCount
 */

/**
 * Per-tab bookkeeping so transitions and stateIdAtTime work across worker restarts.
 * @typedef {Object} TabInfo
 * @property {string|null} lastStateId
 * @property {string|null} lastSignature
 * @property {string|null} lastErrorsKey
 */

/** @typedef {Record<string, TabInfo>} TabMap */

/**
 * @typedef {Object} ExportManifest
 * @property {string} tool
 * @property {string} version
 * @property {string} exportedAt
 * @property {string} sessionStartedAt
 * @property {{ states: number, domSnapshots: number, screenshots: number, netEntries: number }} counts
 * @property {string[]} origins
 * @property {{ fieldValues: string, domValues: string, bodies: string }} redaction
 * @property {string[]} warnings
 * @property {string} harNote
 */

/**
 * @typedef {Object} FieldMapEntry
 * @property {string} key
 * @property {string[]} altKeys   every other identifier seen for this field: id, name, formControlName, label (Q16)
 * @property {string[]} seenOnStates
 * @property {string} label
 * @property {LabelSource} labelSource
 * @property {string} type
 * @property {boolean} required
 * @property {number|null} maxLength
 * @property {string|null} pattern
 * @property {{ primary: string, fallbacks: string[], stability: SelectorStability }} selectors
 * @property {SelectOption[]|null} options
 * @property {string[]} dependsOn
 * @property {string[]} affects
 * @property {null} vcfoField
 * @property {string} notes
 */

/**
 * @typedef {Object} FieldMapDraft
 * @property {string} generatedAt
 * @property {FieldMapEntry[]} fields
 * @property {Dependency[]} dependencies
 * @property {Transition[]} transitions
 */

/**
 * Snapshot the panel polls for. Small on purpose: no fields, no snapshots.
 * @typedef {Object} Stats
 * @property {number} states
 * @property {number} net
 * @property {number} screenshots
 * @property {boolean} recording
 * @property {boolean} screenshotsEnabled
 * @property {string} sessionStartedAt
 * @property {ExportProgress} exportProgress
 */

/**
 * @typedef {Object} ExportProgress
 * @property {boolean} active
 * @property {number} current
 * @property {number} total
 * @property {string|null} error
 * @property {string|null} warning   non-fatal advice, e.g. per-file save prompts detected (Q15)
 * @property {string|null} folder   set when the last export finished
 */

/**
 * One row of the side panel's live feed. Slimmed from StateRecord so the
 * panel never receives selectors, options or snapshots.
 * @typedef {Object} PanelRow
 * @property {string} id
 * @property {number} seq
 * @property {string} title
 * @property {string} pathname
 * @property {string} trigger
 * @property {string} capturedAt
 * @property {number} fieldCount
 * @property {number} errorCount
 * @property {boolean} newFields   the transition into this state added fields
 * @property {boolean} duplicate   manual capture identical to the previous state
 * @property {boolean} inIframe
 * @property {string[]} headings
 * @property {StepRecord[]} steps
 * @property {string[]} fieldLabels   first ten labels (or keys when unlabelled)
 */

export {};
