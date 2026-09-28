# ADR-0051: Bounded Native Knowledge Canvas

- Status: Accepted
- Date: 2026-09-29
- Scope: R3 knowledge network and reusable reader projection
- Related: ADR-0042, ADR-0045, ADR-0050

## Decision

Use native SVG and the existing workbench controls for the knowledge canvas.
The approved interactions need deterministic placement, zoom, scrolling, selection
and decisions. Compared with `@xyflow/react`, SVG avoids a new dependency and
controlled dragging/editing state that this scope does not need. The existing
review graph is a textual prerequisite projection; preserve its semantics and
reuse that accessible-list approach alongside SVG. Do not modify the old page.

The online graph endpoint returns at most 200 nodes and 400 relationships. Each
query has a SQL bound. A question or resource focus expands at most two hops;
the focus is authorized before expansion. Nodes are selected across types so a
large paper library does not displace every question and concept. An explicit
truncation flag tells the client to narrow its focus. Deleted or inaccessible
nodes, evidence and rejected edges remain excluded using the existing private
link authorization filters. GET performs no data mutation. Existing topic
prerequisites are displayed read-only and are never copied into knowledge edges.

Layout is deterministic, grouped by type, and has no force simulation. Node and
edge buttons support Enter/Space and visible focus. Full titles and reasons are
available in details and a corresponding text list. At narrow widths the list
provides the complete selection and decision flow. Solid/dashed lines and text
labels distinguish confirmed/suggested edges in both themes without relying on
color alone.

The manual form uses the existing owner-only link endpoint. The AI form sends
only explicitly checked allowlisted source references through the existing
research AI route after send confirmation. It excludes ideas and never serializes
the graph, adjacency or manual reasons. The server independently revalidates all
references. Suggestions stay provisional until an owner decision. No new offline
storage, AI context class, dependency, migration or production capability is added.

## Validation and rollback

Check scope isolation, focus, read-only retrieval and the 200/400 bounds against
the real database; exercise owner decisions and the private-idea sentinel through
the real API/Worker browser flow. Test keyboard interaction with a synthetic
200-node/400-edge view and capture four widths in both themes. Disable the existing
research flag to hide the surface while retaining data.
