"""Bounded in-memory subgraph extraction for the knowledge space.

This module is a self-contained, pure-Python kernel. It performs *no*
authentication, authorization, database access, network I/O, or persistence.
Callers MUST hand it already-authorization-filtered nodes and edges; the kernel
only bounds and shapes them.

Semantics
---------
``bounded_subgraph`` returns the subgraph *induced* by every node reachable
from ``root_id`` within ``max_hops`` undirected hops (``1`` or ``2``), capped by
``max_nodes`` and ``max_edges``. Edges are treated as undirected for hop
expansion: an edge connects its two endpoints and each endpoint counts as a
neighbour of the other. The returned edges are exactly those de-duplicated
edges whose *both* endpoints survive the node cap and the hop bound.

Traversal is iterative breadth-first; it never recurses, so cycles,
self-loops, and repeated edges cannot exhaust the stack or loop forever.

Determinism
-----------
Output is stable and independent of input order. Candidate neighbours are
visited in sorted id order and candidate edges are sorted by id, so the
selected node/edge sets depend only on graph topology and the limits -- never
on the order in which the caller supplied the data.

Edges are de-duplicated by id. A unique edge, or duplicates that all share one
direction, survive in that direction -- the kernel preserves the caller's
direction and does not rewrite it just because hop traversal is undirected.
Only the genuinely ambiguous case, where the same id appears in *both*
directions over the same undirected endpoint pair (``r->a`` and ``a->r``),
collapses to one canonical edge whose stored direction is the lexicographically
smaller source, so the survivor is identical regardless of input order. Two
edges that share an id but join *different* undirected endpoint pairs are an
ambiguous input and raise a deterministic ``ValueError`` whose message lists the
conflicting pairs in sorted order, so it too is independent of input order.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = [
    "ALLOWED_HOPS",
    "DEFAULT_MAX_HOPS",
    "HARD_MAX_EDGES",
    "HARD_MAX_NODES",
    "BoundedSubgraph",
    "EDGE_ID_CONFLICT",
    "GraphEdge",
    "GraphNode",
    "TruncationReason",
    "bounded_subgraph",
]


DEFAULT_MAX_HOPS = 2
ALLOWED_HOPS: frozenset[int] = frozenset({1, 2})
HARD_MAX_NODES = 150
HARD_MAX_EDGES = 400

#: Stable substring present in every edge-id/endpoint conflict error message,
#: so callers and tests can detect the failure without matching exact wording.
EDGE_ID_CONFLICT = "edge id conflict"


class TruncationReason:
    """Reasons a bounded subgraph may be cut short.

    Values are plain strings so they serialise and compare naturally. Reaching
    the hop bound is intentional and is therefore *not* a truncation reason;
    only the node and edge caps can truncate output.
    """

    MAX_NODES = "max_nodes"
    MAX_EDGES = "max_edges"


class GraphNode:
    """An authorization-filtered in-memory node, identified by a stable id.

    Nodes are compared and ordered by ``id``. The kernel carries no payload:
    callers map their richer domain objects onto this lightweight identity when
    they hand the already-filtered graph to the kernel.
    """

    __slots__ = ("id",)

    def __init__(self, id: str) -> None:
        self.id = id

    def __eq__(self, other: object) -> bool:
        return isinstance(other, GraphNode) and other.id == self.id

    def __hash__(self) -> int:
        return hash(("GraphNode", self.id))

    def __lt__(self, other: GraphNode) -> bool:
        return self.id < other.id

    def __repr__(self) -> str:
        return f"GraphNode(id={self.id!r})"


class GraphEdge:
    """An authorization-filtered in-memory edge.

    ``id`` uniquely identifies the edge and drives de-duplication. Hop expansion
    treats the edge as undirected, so both ``source`` and ``target`` count as
    neighbours of each other; this does **not** rewrite the returned edge's
    direction. A unique edge, or duplicates that all share one direction,
    survive in that direction. Only when the same id appears in both directions
    over the same undirected pair does de-duplication collapse them onto one
    canonical ``(low, high)`` edge. Self-loops (``source == target``) are
    permitted and cannot cause runaway traversal.
    """

    __slots__ = ("id", "source", "target")

    def __init__(self, id: str, source: str, target: str) -> None:
        self.id = id
        self.source = source
        self.target = target

    def _signature(self) -> tuple[str, str, str]:
        return (self.id, self.source, self.target)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, GraphEdge) and other._signature() == self._signature()

    def __hash__(self) -> int:
        return hash(("GraphEdge", *self._signature()))

    def __lt__(self, other: GraphEdge) -> bool:
        return self._signature() < other._signature()

    def __repr__(self) -> str:
        return f"GraphEdge(id={self.id!r}, source={self.source!r}, target={self.target!r})"


class BoundedSubgraph:
    """The deterministic result of a bounded subgraph extraction.

    Attributes:
        nodes: Visited nodes, sorted ascending by id.
        edges: Selected edges (both endpoints visited), sorted ascending by id.
        truncated: True iff any cap forced output to be dropped.
        truncation_reasons: Which cap(s) bound the output; empty iff not truncated.
        hops_reached: Largest hop distance actually reached from the root (0 if
            only the root was visited).
    """

    __slots__ = (
        "nodes",
        "edges",
        "truncated",
        "truncation_reasons",
        "hops_reached",
    )

    def __init__(
        self,
        *,
        nodes: tuple[GraphNode, ...],
        edges: tuple[GraphEdge, ...],
        truncated: bool,
        truncation_reasons: frozenset[str],
        hops_reached: int,
    ) -> None:
        self.nodes = nodes
        self.edges = edges
        self.truncated = truncated
        self.truncation_reasons = truncation_reasons
        self.hops_reached = hops_reached

    def _signature(self) -> tuple[object, ...]:
        return (
            self.nodes,
            self.edges,
            self.truncated,
            self.truncation_reasons,
            self.hops_reached,
        )

    def __eq__(self, other: object) -> bool:
        return isinstance(other, BoundedSubgraph) and other._signature() == self._signature()

    def __hash__(self) -> int:
        return hash(("BoundedSubgraph", *self._signature()))

    def __repr__(self) -> str:
        reasons = ", ".join(sorted(self.truncation_reasons)) or "(none)"
        return (
            "BoundedSubgraph("
            f"nodes={len(self.nodes)}, edges={len(self.edges)}, "
            f"truncated={self.truncated}, reasons={{{reasons}}}, "
            f"hops_reached={self.hops_reached})"
        )


def bounded_subgraph(
    root_id: str,
    nodes: Iterable[GraphNode],
    edges: Iterable[GraphEdge],
    *,
    max_hops: int = DEFAULT_MAX_HOPS,
    max_nodes: int = HARD_MAX_NODES,
    max_edges: int = HARD_MAX_EDGES,
) -> BoundedSubgraph:
    """Return the bounded subgraph induced around ``root_id``.

    Args:
        root_id: The node to expand from. Must be present in ``nodes``.
        nodes: Already-authorization-filtered nodes.
        edges: Already-authorization-filtered edges.
        max_hops: Hop bound; must be ``1`` or ``2``.
        max_nodes: Node cap in ``[1, 150]`` (caller may lower, never raise).
        max_edges: Edge cap in ``[1, 400]`` (caller may lower, never raise).

    Raises:
        ValueError: If ``root_id`` is absent from ``nodes``, any edge dangles
            (references an unknown node), any edge id joins distinct undirected
            endpoint pairs (an ``EDGE_ID_CONFLICT``), or any limit is out of
            range.

    Returns:
        A deterministic :class:`BoundedSubgraph`.
    """
    _validate_limits(max_hops=max_hops, max_nodes=max_nodes, max_edges=max_edges)

    node_by_id = _index_nodes(nodes)
    if root_id not in node_by_id:
        raise ValueError(f"root id {root_id!r} is not present in nodes")

    deduped_edges = _dedupe_edges(edges)
    _validate_edges(deduped_edges, available=node_by_id)

    adjacency = _build_adjacency(deduped_edges)
    visited, hops_reached, node_reason = _discover_nodes(
        root_id=root_id,
        adjacency=adjacency,
        max_hops=max_hops,
        max_nodes=max_nodes,
    )
    selected_edges, edge_reason = _select_edges(
        deduped_edges=deduped_edges,
        visited=visited,
        max_edges=max_edges,
    )

    reasons = node_reason | edge_reason
    ordered_nodes = tuple(node_by_id[node_id] for node_id in sorted(visited))

    return BoundedSubgraph(
        nodes=ordered_nodes,
        edges=selected_edges,
        truncated=bool(reasons),
        truncation_reasons=reasons,
        hops_reached=hops_reached,
    )


def _validate_limits(*, max_hops: object, max_nodes: object, max_edges: object) -> None:
    """Raise ``ValueError`` for any out-of-range or mistyped limit.

    Parameters are typed ``object`` so the runtime type guards below remain
    reachable under ``mypy --warn-unreachable`` (a ``bool`` is an ``int``
    subclass and is rejected explicitly because a boolean limit is meaningless).
    """
    if isinstance(max_hops, bool) or not isinstance(max_hops, int):
        raise ValueError(f"max_hops must be a non-bool int (1 or 2); got {max_hops!r}")
    if max_hops not in ALLOWED_HOPS:
        raise ValueError(f"max_hops must be one of {sorted(ALLOWED_HOPS)}; got {max_hops}")

    if isinstance(max_nodes, bool) or not isinstance(max_nodes, int):
        raise ValueError(f"max_nodes must be a non-bool int; got {max_nodes!r}")
    if not 1 <= max_nodes <= HARD_MAX_NODES:
        raise ValueError(
            f"max_nodes must be within [1, {HARD_MAX_NODES}]; got {max_nodes}",
        )

    if isinstance(max_edges, bool) or not isinstance(max_edges, int):
        raise ValueError(f"max_edges must be a non-bool int; got {max_edges!r}")
    if not 1 <= max_edges <= HARD_MAX_EDGES:
        raise ValueError(
            f"max_edges must be within [1, {HARD_MAX_EDGES}]; got {max_edges}",
        )


def _index_nodes(nodes: Iterable[GraphNode]) -> dict[str, GraphNode]:
    """Index nodes by id, keeping the first occurrence of any duplicate id."""
    node_by_id: dict[str, GraphNode] = {}
    for node in nodes:
        if node.id not in node_by_id:
            node_by_id[node.id] = node
    return node_by_id


def _undirected_pair(edge: GraphEdge) -> tuple[str, str]:
    """Return the canonical undirected endpoint pair for ``edge``.

    The pair is sorted so ``r->a`` and ``a->r`` map to the same key. The stored
    canonical direction is ``(low, high)``, which makes the surviving edge after
    de-duplication identical regardless of input order.
    """
    low, high = sorted((edge.source, edge.target))
    return low, high


def _dedupe_edges(edges: Iterable[GraphEdge]) -> list[GraphEdge]:
    """De-duplicate edges by id with order-independent, conflict-aware semantics.

    Returned edges normally keep their input direction: a unique edge, or
    duplicates that all share one direction, survive in that direction. Only the
    genuinely ambiguous case -- the same id appearing in *both* directions over
    the same undirected pair -- collapses to the single canonical edge
    ``(low, high)`` so the survivor is identical regardless of input order.

    For each edge id:
      * first sighting -> record its undirected pair and the directed
        signature(s) seen;
      * a later sighting with the *same* undirected pair -> add its directed
        signature to the set (so we can later tell forward+reverse apart);
      * a later sighting with a *different* undirected pair raises a
        deterministic ``ValueError`` whose message lists the two conflicting
        pairs in sorted order, so forward and reverse inputs report identical
        text.

    After the sweep, each id resolves to one edge: its stored direction if only
    one directed signature appeared, otherwise the canonical ``(low, high)``.
    Genuinely parallel edges (distinct ids) are unaffected. Conflict detection
    runs on edge endpoints alone, before any dangling-node check, so input order
    can never choose between "conflict" and "dangling" outcomes.
    """
    undirected: dict[str, tuple[str, str]] = {}
    directed_signatures: dict[str, set[tuple[str, str]]] = {}

    for edge in edges:
        pair = _undirected_pair(edge)
        existing = undirected.get(edge.id)
        if existing is None:
            undirected[edge.id] = pair
            directed_signatures[edge.id] = {(edge.source, edge.target)}
        elif existing != pair:
            # Deterministic message: present the two pairs in sorted order so
            # forward and reverse inputs raise identical text.
            first, second = sorted((existing, pair))
            raise ValueError(
                f"{EDGE_ID_CONFLICT}: edge id {edge.id!r} joins distinct "
                f"undirected endpoint pairs {first} and {second}",
            )
        else:
            directed_signatures[edge.id].add((edge.source, edge.target))

    deduped: list[GraphEdge] = []
    for edge_id in sorted(undirected):
        pair = undirected[edge_id]
        signatures = directed_signatures[edge_id]
        if len(signatures) == 1:
            # Unique direction (unique edge, or all duplicates agree): preserve
            # the single directed signature verbatim.
            source, target = next(iter(signatures))
        else:
            # Both directions of the same undirected pair appeared: this is the
            # only ambiguous case, so collapse to the canonical direction.
            source, target = pair
        deduped.append(GraphEdge(id=edge_id, source=source, target=target))

    return deduped


def _validate_edges(edges: list[GraphEdge], *, available: dict[str, GraphNode]) -> None:
    """Raise ``ValueError`` if any edge references an unknown node."""
    for edge in edges:
        if edge.source not in available or edge.target not in available:
            raise ValueError(
                f"edge {edge.id!r} references an unknown node "
                f"(source={edge.source!r}, target={edge.target!r})",
            )


def _build_adjacency(edges: list[GraphEdge]) -> dict[str, set[str]]:
    """Build undirected adjacency: each endpoint lists the other.

    Self-loops (``source == target``) simply add the node to its own neighbour
    set, which is harmless because visited nodes are never re-expanded.
    """
    adjacency: dict[str, set[str]] = {}
    for edge in edges:
        adjacency.setdefault(edge.source, set()).add(edge.target)
        adjacency.setdefault(edge.target, set()).add(edge.source)
    return adjacency


def _discover_nodes(
    *,
    root_id: str,
    adjacency: dict[str, set[str]],
    max_hops: int,
    max_nodes: int,
) -> tuple[set[str], int, frozenset[str]]:
    """Iteratively BFS from ``root_id`` up to ``max_hops``, capped by ``max_nodes``.

    Returns the visited id set, the largest hop distance reached (0 if only the
    root was visited), and a truncation-reason set (``{MAX_NODES}`` if the node
    cap dropped any reachable node, else empty). Neighbours are always scanned
    in sorted id order so the visited set is independent of input order.
    """
    distance: dict[str, int] = {root_id: 0}
    frontier: list[str] = [root_id]
    hops_reached = 0
    truncated_nodes = False

    for hop in range(1, max_hops + 1):
        next_frontier: list[str] = []
        for current in sorted(frontier):
            for neighbour in sorted(adjacency.get(current, ())):
                if neighbour in distance:
                    continue
                if len(distance) >= max_nodes:
                    # Node cap saturated: this reachable node is dropped. Keep
                    # scanning only to stay simple; no further node can be added.
                    truncated_nodes = True
                    continue
                distance[neighbour] = hop
                next_frontier.append(neighbour)
                hops_reached = hop
        if not next_frontier:
            break
        frontier = next_frontier

    reasons = frozenset({TruncationReason.MAX_NODES}) if truncated_nodes else frozenset()
    return set(distance), hops_reached, reasons


def _select_edges(
    *,
    deduped_edges: list[GraphEdge],
    visited: set[str],
    max_edges: int,
) -> tuple[tuple[GraphEdge, ...], frozenset[str]]:
    """Pick induced edges (both endpoints visited), sorted by id, capped.

    Returns the selected edge tuple and a truncation-reason set
    (``{MAX_EDGES}`` if any qualifying edge was dropped, else empty). Sorting
    by id before slicing makes the selected subset independent of input order.
    """
    qualifying = [
        edge
        for edge in sorted(deduped_edges, key=lambda candidate: candidate.id)
        if edge.source in visited and edge.target in visited
    ]
    if len(qualifying) <= max_edges:
        return tuple(qualifying), frozenset()
    return tuple(qualifying[:max_edges]), frozenset({TruncationReason.MAX_EDGES})
