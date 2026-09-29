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
 * @property {string|null} current   docs/12 B2: scrubbed text of the active page or indicator, ≤40 chars
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
 * @property {string} route          docs/12 B1: pathname plus the fragment's path part; no query
 * @property {string[]} queryKeys    docs/12 B1: parameter names only, sorted
 * @property {NavInventory} nav      docs/12 B3
 * @property {ViewState} view        docs/12 B2
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
 *   actionIds: string[],
 *   openedFrom: OpenedFrom|null,
 * }} StateRecord
 */

/**
 * docs/12 B4: the first state in a tab that a recorded click opened.
 * @typedef {{ tabId: number, stateId: string|null, actionId: string|null }} OpenedFrom
 */

// ------------------------------------------------ docs/12 B2/B3: navigation

/**
 * One menu or navigation item.
 * @typedef {Object} NavItem
 * @property {string} text        scrubbed, ≤80 chars
 * @property {string[]} path      labels from the menu root down to this item, inclusive
 * @property {number} depth       path.length - 1
 * @property {string} selector
 * @property {string[]} shadowPath
 * @property {string|null} href   path plus fragment path only, scrubbed; null when scripted
 * @property {boolean} visible
 * @property {boolean|null} expanded   null when the item has no expandable state
 * @property {boolean} hasChildren
 * @property {boolean} current    marked as the current page by the site
 */

/**
 * @typedef {Object} ViewOption
 * @property {string} text
 * @property {string} selector
 * @property {boolean} active
 * @property {boolean} disabled
 * @property {boolean} visible
 */

/**
 * A control group that switches what a page shows without leaving it.
 * @typedef {Object} ViewGroup
 * @property {'tabs'|'segmented'|'chips'|'radio'|'select'} kind
 * @property {string} label       group label when one resolves, else ''
 * @property {string} name        identity used in view keys: label, else a short selector-derived name
 * @property {string} containerSelector
 * @property {string[]} shadowPath
 * @property {ViewOption[]} options
 */

/**
 * @typedef {Object} NavInventory
 * @property {NavItem[]} menus
 * @property {ViewGroup[]} viewGroups
 * @property {string[]} breadcrumbs
 */

/**
 * @typedef {Object} ViewState
 * @property {string} key   `group=option|group=option|page=2`; '' when the page has no view groups
 * @property {{ group: string, option: string }[]} active
 */

// --------------------------------------------------- docs/12 B4: actions

/** @typedef {'link'|'button'|'tab'|'menuitem'|'option'|'checkbox'|'radio'|'select'|'summary'|'row'|'other'} ActionTargetType */

/**
 * @typedef {Object} ActionSelectors
 * @property {string} primary
 * @property {string[]} fallbacks
 * @property {string[]} shadowPath
 * @property {SelectorStability} stability
 * @property {boolean} unique
 * @property {string|null} role   explicit or implied ARIA role, for role-based locators
 * @property {string} name        accessible name, scrubbed, ≤80 chars
 */

/**
 * What the content script sends the moment the user acts.
 * @typedef {Object} ActionDraft
 * @property {'click'|'change'} kind
 * @property {string} trigger     the same string the state's `trigger` will carry
 * @property {string} at
 * @property {string} origin
 * @property {string} route       route at the moment of the action
 * @property {string} viewKey     view key at the moment of the action
 * @property {string} label       scrubbed, ≤80 chars
 * @property {string} tag
 * @property {ActionTargetType} targetType
 * @property {ActionSelectors|null} selectors
 * @property {string|null} href
 * @property {string|null} target     e.g. `_blank`
 * @property {string[]} menuPath      empty when the target is not a menu item
 * @property {boolean} inNav
 * @property {string|null} viewGroup  `ViewGroup.name` when the target is one of its options
 * @property {boolean} pagination
 * @property {'next'|'prev'|'page'|'load-more'|null} paginationRole
 * @property {string|null} listSelector   container of the list or table the target sits inside
 * @property {boolean} danger
 * @property {boolean} download       anchor with `download`, or an href with a document extension
 * @property {string|null} controlKey    change actions: the control's key
 * @property {string|null} chosen        change actions on non-credential selects/radios/checkboxes: option text, scrubbed
 * @property {boolean} inIframe
 */

/**
 * @typedef {ActionDraft & {
 *   id: string,
 *   seq: number,
 *   tabId: number,
 *   frameId: number,
 *   stateIdAtTime: string|null,
 *   resultStateId: string|null,
 * }} ActionEntry
 */

// ------------------------------------------------ docs/12 B5: API shapes

/**
 * Structure of a JSON value with the values taken out.
 * @typedef {Object} JsonShape
 * @property {'object'|'array'|'string'|'number'|'boolean'|'null'|'mixed'|'truncated'} t
 * @property {Record<string, JsonShape>} [keys]   object
 * @property {string[]} [optional]     object: keys missing from some merged samples
 * @property {number} [len]            array length, or longest string length seen
 * @property {JsonShape|null} [item]   array: merged shape of its items
 * @property {'date'|'datetime'|'numeric'|'url'|'email'|'uuid'|'boolean'|'text'} [format]   string
 * @property {string[]} [values]       string: enum-like distinct values, scrubbed
 * @property {boolean} [nullable]
 */

// -------------------------------------------------- docs/12 B6: downloads

/**
 * @typedef {Object} DownloadEntry
 * @property {string} id              `dl_0001`
 * @property {number} seq
 * @property {string} at
 * @property {string} origin          consented origin it is attributed to
 * @property {'http'|'blob'|'data'} urlKind
 * @property {string|null} url        scrubbed, no query values; null for blob/data
 * @property {string[]} queryKeys
 * @property {string} mime
 * @property {string|null} extension
 * @property {string} nameShape       letters → `A{n}`, digits → `9{n}`; never the file name
 * @property {number} sizeBytes       -1 when unknown
 * @property {'in_progress'|'complete'|'interrupted'} state
 * @property {number} tabId           -1 when it could not be attributed
 * @property {string|null} route
 * @property {string|null} stateIdAtTime
 * @property {string|null} actionId
 * @property {string|null} netId
 * @property {{ mime: string, size: number }|null} blob   from the MAIN-world createObjectURL hint
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
 * @property {JsonShape|null} requestShape    docs/12 B5
 * @property {JsonShape|null} responseShape   docs/12 B5
 * @property {number} responseSize            characters read before truncation; -1 when unread
 * @property {boolean} bodyTruncated
 * @property {'attachment'|'inline'|null} disposition
 * @property {string|null} dispositionExt     extension from content-disposition; never the file name
 * @property {boolean} isDownload             attachment disposition, or a binary document MIME type
 * @property {string|null} [responseFull]     only in transit and only when keepBodies is 'full'; never stored in fp:net
 */

/**
 * @typedef {NetDraft & {
 *   id: string,
 *   seq: number,
 *   tabId: number,
 *   frameId: number,
 *   stateIdAtTime: string|null,
 *   stateIdInferred: boolean,
 *   actionIdAtTime: string|null,
 *   hasFullBody: boolean,
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
 * @property {string[]} actionIds     docs/12 B4: every action between the two states
 * @property {string|null} actionId   the one that caused the change, as far as can be told
 * @property {boolean} routeChanged
 * @property {boolean} viewChanged
 * @property {boolean} viaNewTab
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
 * @property {boolean} bodiesDropped   docs/12 B7: full API bodies dropped
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
 * @property {'shape'|'full'} keepBodies   docs/12 B5
 * @property {number} actionSeq
 * @property {number} actionCount
 * @property {number} downloadSeq
 * @property {number} downloadCount
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
 * @property {string|null} [lastRoute]
 * @property {string|null} [lastActionId]
 * @property {string|null} [lastActionAt]
 * @property {OpenedFrom|null} [openedFrom]     pending link for the first state of a new tab
 * @property {{ mime: string, size: number, at: string }|null} [blobHint]
 * @property {{ url: string|null, target: string|null, at: string }|null} [openHint]
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
 * @property {{ states: number, domSnapshots: number, screenshots: number, netEntries: number, listPatterns: number, transitions: number, dependencies: number, actions: number, downloads: number, pages: number, endpoints: number }} counts
 * @property {{ packs: string[], fieldValues: string, domValues: string, bodies: string, apiShapes: string, downloads: string }} redaction
 * @property {'shape'|'full'} keepBodies
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
 * @property {string} route
 * @property {string} viewKey
 * @property {string|null} pageId
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
 * @property {number} actions
 * @property {number} downloads
 * @property {'shape'|'full'} keepBodies
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
 * @property {string} route
 * @property {string} viewKey
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

// ------------------------------------------------ docs/12 B8: export files

/**
 * One menu item merged across every state it was seen on.
 * @typedef {Object} SiteMapNode
 * @property {string} id            path joined with ' > ', lowercased
 * @property {string} text
 * @property {string[]} path
 * @property {number} depth
 * @property {string} selector
 * @property {string[]} shadowPath
 * @property {string|null} href
 * @property {boolean} hasChildren
 * @property {string[]} seenOnStates
 * @property {boolean} visited
 * @property {string[]} visitedBy   action ids
 * @property {string[]} leadsTo     page ids
 */

/**
 * @typedef {Object} SiteViewOption
 * @property {string} text
 * @property {string} selector
 * @property {boolean} visited   seen active on a state, or clicked
 */

/**
 * @typedef {Object} SiteViewGroup
 * @property {string} name
 * @property {string} label
 * @property {'tabs'|'segmented'|'chips'|'radio'|'select'} kind
 * @property {string} containerSelector
 * @property {string[]} shadowPath
 * @property {SiteViewOption[]} options
 */

/**
 * @typedef {Object} SiteList
 * @property {'table'|'repeat'} kind
 * @property {string} selector
 * @property {string[]} headers        tables only
 * @property {boolean} hasPagination
 * @property {boolean} paged           a pagination action was recorded on this page
 * @property {boolean} itemOpened      an action inside an item led somewhere
 * @property {boolean} downloadSeen    a download was attributed to an action inside it
 * @property {string[]} apiEndpoints   endpoint ids that most likely feed it
 */

/**
 * One distinct route.
 * @typedef {Object} SitePage
 * @property {string} id              `pg_001`
 * @property {string} route
 * @property {string} title
 * @property {string[]} headings      first five
 * @property {string[]} stateIds
 * @property {{ key: string, stateIds: string[] }[]} views
 * @property {SiteViewGroup[]} viewGroups
 * @property {SiteList[]} lists
 * @property {string[]} apiEndpoints
 * @property {string[]} downloadIds
 * @property {boolean} loggedIn
 */

/**
 * @typedef {Object} SiteMap
 * @property {string} generatedAt
 * @property {string} origin
 * @property {string|null} entryStateId
 * @property {SiteMapNode[]} menu
 * @property {SitePage[]} pages
 */

/**
 * @typedef {Object} RouteStep
 * @property {number} n
 * @property {string} actionId
 * @property {'click'|'change'} kind
 * @property {string} label
 * @property {ActionSelectors|null} selectors
 * @property {string[]} menuPath
 * @property {string|null} href
 * @property {string|null} chosen
 * @property {string} fromStateId
 * @property {string} toStateId
 * @property {string} expectRoute
 * @property {string} expectViewKey
 * @property {string|null} expectHeading
 * @property {boolean} opensNewTab
 */

/**
 * @typedef {Object} RouteRecipe
 * @property {string} pageId
 * @property {string} route
 * @property {string} viewKey
 * @property {string} targetStateId
 * @property {boolean} reachable
 * @property {string|null} directUrl   origin + route, only when that route was observed as a page load
 * @property {RouteStep[]} steps
 * @property {string} note
 */

/**
 * @typedef {Object} RoutesFile
 * @property {string} generatedAt
 * @property {string} origin
 * @property {string|null} entryStateId
 * @property {string|null} entryRoute
 * @property {RouteRecipe[]} recipes
 */

/**
 * @typedef {Object} ApiEndpoint
 * @property {string} id             `api_001`
 * @property {string} method
 * @property {string} urlTemplate    varying and identifier-like path segments are `{id}`
 * @property {string} host
 * @property {string[]} queryKeys
 * @property {number} count
 * @property {number[]} statuses
 * @property {string} mimeType
 * @property {JsonShape|null} requestShape
 * @property {JsonShape|null} responseShape
 * @property {{ path: string, len: number }[]} listPaths   arrays in the response that look like rows
 * @property {string[]} pagingParams
 * @property {string[]} calledFromRoutes
 * @property {string[]} stateIds
 * @property {string[]} actionIds
 * @property {string[]} netIds
 * @property {boolean} isDownload
 * @property {boolean} hasFullBody
 */

/**
 * @typedef {Object} ApiCatalog
 * @property {string} generatedAt
 * @property {string} origin
 * @property {ApiEndpoint[]} endpoints
 */

/**
 * @typedef {Object} CoveragePage
 * @property {string} pageId
 * @property {string} route
 * @property {string} title
 * @property {{ name: string, options: { text: string, visited: boolean }[] }[]} viewGroups
 * @property {{ selector: string, kind: 'table'|'repeat', hasPagination: boolean, paged: boolean, itemOpened: boolean, downloadSeen: boolean }[]} lists
 * @property {number} downloads
 * @property {number} apiCalls
 * @property {boolean} complete
 * @property {string[]} missing   plain sentences
 */

/**
 * @typedef {Object} Coverage
 * @property {string} generatedAt
 * @property {string} origin
 * @property {{ menuItems: number, menuVisited: number, pages: number, viewOptions: number, viewOptionsVisited: number, lists: number, listsPaged: number, downloads: number }} totals
 * @property {{ id: string, path: string[], selector: string }[]} unvisitedMenu
 * @property {CoveragePage[]} pages
 * @property {string[]} hints   most valuable first, ≤30
 */

/**
 * Reply to `fp:get-coverage`. `page` is the entry for the route asked about, when recorded.
 * @typedef {Object} CoverageReply
 * @property {boolean} ok
 * @property {Coverage|null} coverage
 * @property {CoveragePage|null} page
 */

export {};
