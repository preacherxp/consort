# Design references for a sleeker, more fluid Consort

Researched 2026-09-18. Links below were opened and checked against the original sites/articles. Source observations and proposed applications are distinguished; these are references, not designs or assets to copy wholesale.

## Recommended direction

**Linear's restraint + Family's tactile interactions + Rauno's continuity.** Keep Consort's plum, rose and cream identity, readable text, cards-first layout and dating metaphor. Make it feel more intentional through hierarchy and connected state changes—not more decoration.

## Primary references

### 1. Linear — visual hierarchy and surface discipline

[How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)

**Source:** Linear describes reducing visual noise, aligning controls, improving hierarchy, and building its theme around base color, accent and contrast. It also discusses using perceptually uniform color and limiting colored chrome.

**Borrow for Consort:** a small, consistent surface system: background → composer → active profile. Keep one strong rose action; use quieter supporting borders and consistent icon/text alignment. Preserve the distinctly visible input and readable labels rather than confusing “minimal” with low contrast or tiny text.

**Do not borrow:** dashboard density, sidebars, or the entire monochrome SaaS aesthetic.

### 2. Family — tactile, friendly product interactions

[Family](https://family.co/)

**Source:** the official site includes product demonstrations for sending/receiving, wallet organization, drag-and-drop and transitions between transaction states. Its “Details that matter” section emphasizes state transitions; the “Fun” section explicitly focuses on delightful interactions.

**Borrow for Consort:** a small amount of card depth, responsive press feedback, and an inviting match reveal. Use the deck metaphor consistently from searching to choosing.

**Do not borrow:** the colorful mascot-heavy marketing hero, wallet UI, or excessive bounce. The transferable reference is the product's interaction character, not its crypto branding.

### 3. Rauno Freiberg — fluidity and spatial consistency

- [Craft gallery](https://rauno.me/craft) — browse **Toolbar Morph**, **Spatial Tooltip**, **Blur Reveal**, and **Liquid Swipe**.
- [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design)
- [Designing Depth](https://rauno.me/craft/depth)

**Source:** the interaction essay examines responsive gestures, momentum, spatial consistency, interruptibility and when frequent interactions should avoid animation. The depth essay discusses layering, choreography and using motion to communicate interactivity.

**Borrow for Consort:** make idle → searching → result feel like one surface changing state, instead of unrelated panels fading in and out. Keep the card attached to the pointer during drag, then settle it naturally. Keep cancel/retry immediate; never hold a returned result just to complete a flourish.

**Do not borrow:** elaborate shaders, dramatic blur on readable content, cursor gimmicks, or animation on every keystroke.

### 4. Emil Kowalski — practical animation refinement

[Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations)

**Source:** this public article covers origin-aware transitions, selecting easing, spring-smoothed interactions, and coordinating a segmented control's moving highlight with its label colors. It includes interactive examples.

**Borrow for Consort:** one sliding selection pill for Task fit / Faster / Best quality; a common press/release response for presets and actions; transitions that originate from the element the user interacted with.

**Optional deeper resource:** [animations.dev](https://animations.dev/). The publicly accessible landing page describes a paid course; enrollment was closed when checked. The free article above is actionable without course access. No paid course material was accessed for these notes.

### 5. Raycast — dark-theme clarity

[Raycast](https://www.raycast.com/)

**Observed reference:** its current public page pairs very dark surfaces, crisp light controls, thin edge definition and restrained navigation with a much louder red marketing hero.

**Borrow for Consort:** crisp controls, coherent radii, clean dark surfaces and a small amount of localized illumination around the active card.

**Do not borrow:** the giant red hero treatment or pervasive glow. Those would work against this app's deliberately minimal layout.

### 6. Motion — implementation reference already compatible with the app

- [Layout and shared-element animations](https://motion.dev/docs/react-layout-animations)
- [Reduced-motion handling](https://motion.dev/docs/react-use-reduced-motion)

**Source:** Motion documents `layout` for size/position changes and `layoutId` for transitions between shared elements. `useReducedMotion` exposes the user's preference and supports replacing or disabling spatial motion.

**Apply here:** use the existing Motion dependency rather than adding another animation framework. Coordinate the lobby/result shell and active priority background. Keep drag physics separate from parent layout transforms, and test that layout animation does not scale text or fight touch scrolling.

### Additional visual discovery

[Cosmos](https://www.cosmos.so/) is useful for collecting typography, palettes and composition references. Treat it as a discovery/collection tool, not a technical source for interaction behavior.

## Applied refinement

Implemented after approval: a persistent measured-height recommendation surface (no text/drag scaling), an animated shared priority highlight with native radios, in-place matching rather than remounting the chosen card, quieter plum surfaces and preset pills, consistent press feedback, and static reduced-motion fallbacks. No routing logic changed. State changes render immediately; animation does not delay API requests or wait for an outgoing loader.

The original direction below guided that pass:

1. **One continuous recommendation surface.** Preserve an anchor and shared geometry as the empty state becomes the search animation, then a real profile. Result arrival drives the transition; no artificial delay or fake progress.
2. **More deliberate hierarchy.** Strong profile title, quiet metadata, clear input, one primary action. Avoid adding another bordered box for every detail.
3. **A moving priority indicator.** Keep all three options visible and readable. Use one shared highlight rather than independent background flashes; retain native radio semantics and keyboard navigation.
4. **Unified interaction timing.** Starting points to tune—not universal source prescriptions: roughly 100–140 ms for press feedback, 160–220 ms for small controls, and a restrained spring for profile transitions. Fast repeated actions must stay fast.
5. **Keep the presets useful, not dominant.** The ten presets remain available, but treat them as secondary controls. Keep the stronger contrast the user requested while reducing competition with the submit button.
6. **Limit ornament to meaningful moments.** The searching deck and match reveal are enough. No continuous background movement, oversized portraits, or additional slogans/footer.
7. **Respect reduced motion.** Static search deck, no spatial morphing or shimmer, unchanged state announcements and cancel behavior. Do not trade accessibility for sleekness.

## Acceptance criteria for that pass

- Cards remain above the task input in DOM and visual order.
- Input remains at least 22 px; primary action remains at least 18 px.
- All ten presets, three priority choices, keyboard controls and swipe equivalents remain accessible.
- No motion delays the request, the returned result, cancellation or retry.
- No overflow at narrow phone widths; no animated geometry that disrupts typing or scrolling.
- The interface is equally clear with animations disabled.
- No changes to routing, benchmark evidence or honest attribution are needed for this visual work.
