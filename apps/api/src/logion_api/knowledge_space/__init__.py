"""Knowledge space bounded-graph query domain.

This package currently exposes a self-contained, in-memory bounded subgraph
kernel (:func:`bounded_subgraph`). It performs no authentication, authorization,
database, or network access; callers hand it already-filtered nodes and edges.
"""

from logion_api.knowledge_space.graph_limits import (
    ALLOWED_HOPS,
    DEFAULT_MAX_HOPS,
    EDGE_ID_CONFLICT,
    HARD_MAX_EDGES,
    HARD_MAX_NODES,
    BoundedSubgraph,
    GraphEdge,
    GraphNode,
    TruncationReason,
    bounded_subgraph,
)

__all__ = [
    "ALLOWED_HOPS",
    "DEFAULT_MAX_HOPS",
    "EDGE_ID_CONFLICT",
    "HARD_MAX_EDGES",
    "HARD_MAX_NODES",
    "BoundedSubgraph",
    "GraphEdge",
    "GraphNode",
    "TruncationReason",
    "bounded_subgraph",
]
