"""Tests for the bounded knowledge-space subgraph kernel.

All tests are pure unit tests (no database, no network). They exercise the
public ``bounded_subgraph`` API and verify determinism, hop bounds, de-dup,
truncation, and error handling.
"""

from __future__ import annotations

import pytest
from logion_api.knowledge_space import (
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


def n(id: str) -> GraphNode:
    return GraphNode(id=id)


def e(id: str, source: str, target: str) -> GraphEdge:
    return GraphEdge(id=id, source=source, target=target)


# --------------------------------------------------------------------------- #
# Basic shape
# --------------------------------------------------------------------------- #


def test_root_only_returns_single_node_no_edges() -> None:
    result = bounded_subgraph("r", [n("r")], [])

    assert result.nodes == (n("r"),)
    assert result.edges == ()
    assert result.truncated is False
    assert result.truncation_reasons == frozenset()
    assert result.hops_reached == 0


def test_one_hop_returns_neighbor_and_edge() -> None:
    result = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("e1", "r", "a")],
    )

    assert [node.id for node in result.nodes] == ["a", "r"]
    assert [edge.id for edge in result.edges] == ["e1"]
    assert result.hops_reached == 1
    assert result.truncated is False


def test_two_hop_reaches_two_levels() -> None:
    result = bounded_subgraph(
        "r",
        [n("r"), n("a"), n("b")],
        [e("e1", "r", "a"), e("e2", "a", "b")],
    )

    assert [node.id for node in result.nodes] == ["a", "b", "r"]
    assert [edge.id for edge in result.edges] == ["e1", "e2"]
    assert result.hops_reached == 2


def test_third_hop_excluded() -> None:
    # r - a - b - c : only r,a,b reachable within two hops.
    result = bounded_subgraph(
        "r",
        [n("r"), n("a"), n("b"), n("c")],
        [e("e1", "r", "a"), e("e2", "a", "b"), e("e3", "b", "c")],
    )

    assert [node.id for node in result.nodes] == ["a", "b", "r"]
    assert [edge.id for edge in result.edges] == ["e1", "e2"]
    assert result.hops_reached == 2
    # Not truncation: hop bound is intentional.
    assert result.truncated is False


# --------------------------------------------------------------------------- #
# Cycles, self-loops, de-duplication
# --------------------------------------------------------------------------- #


def test_self_loop_handled_without_infinite_loop() -> None:
    result = bounded_subgraph(
        "r",
        [n("r")],
        [e("loop", "r", "r")],
    )

    assert [node.id for node in result.nodes] == ["r"]
    assert [edge.id for edge in result.edges] == ["loop"]
    assert result.hops_reached == 0


def test_multi_node_ring_terminates() -> None:
    # Triangle r - a - b - r. All reachable within one hop of r.
    result = bounded_subgraph(
        "r",
        [n("r"), n("a"), n("b")],
        [e("e1", "r", "a"), e("e2", "a", "b"), e("e3", "b", "r")],
    )

    assert {node.id for node in result.nodes} == {"r", "a", "b"}
    assert [edge.id for edge in result.edges] == ["e1", "e2", "e3"]
    assert result.hops_reached == 1


def test_large_ring_terminates_within_two_hops() -> None:
    # 50-node ring. From node0, one hop reaches node1 (forward) and node49
    # (back); two hops reach node2 (forward) and node48 (back).
    ids = [f"node{i}" for i in range(50)]
    nodes = [n(node_id) for node_id in ids]
    edges = [e(f"edge{i}", ids[i], ids[(i + 1) % len(ids)]) for i in range(len(ids))]

    result = bounded_subgraph("node0", nodes, edges)

    assert {node.id for node in result.nodes} == {
        "node0",
        "node1",
        "node2",
        "node48",
        "node49",
    }
    assert result.hops_reached == 2
    assert result.truncated is False


def test_duplicate_edges_deduplicated() -> None:
    result = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("dup", "r", "a"), e("dup", "r", "a"), e("dup", "a", "r")],
    )

    assert [edge.id for edge in result.edges] == ["dup"]
    assert [node.id for node in result.nodes] == ["a", "r"]


def test_unique_edge_preserves_source_target_direction() -> None:
    # A unique edge must be returned with its original direction, even though
    # traversal is undirected. Source sorts after target on purpose.
    result = bounded_subgraph(
        "z-source",
        [n("z-source"), n("a-target")],
        [e("e1", "z-source", "a-target")],
    )

    assert [edge.id for edge in result.edges] == ["e1"]
    survivor = result.edges[0]
    assert (survivor.source, survivor.target) == ("z-source", "a-target")


def test_same_id_same_direction_dedupes_and_preserves_direction() -> None:
    # Identical id and identical direction collapse to one edge, keeping it.
    result = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("dup", "r", "a"), e("dup", "r", "a")],
    )

    assert [edge.id for edge in result.edges] == ["dup"]
    assert len(result.edges) == 1
    survivor = result.edges[0]
    assert (survivor.source, survivor.target) == ("r", "a")


def test_same_id_reversed_direction_dedupes_to_canonical() -> None:
    # r->a and a->r share id and the same undirected pair -> one canonical edge.
    forward = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("dup", "r", "a"), e("dup", "a", "r")],
    )
    reverse = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("dup", "a", "r"), e("dup", "r", "a")],
    )

    # Single edge, identical regardless of input order, canonical (a, r).
    assert [edge.id for edge in forward.edges] == ["dup"]
    assert forward == reverse
    survivor = forward.edges[0]
    assert (survivor.source, survivor.target) == ("a", "r")


def test_same_id_distinct_endpoints_forward_raises() -> None:
    with pytest.raises(ValueError, match=EDGE_ID_CONFLICT):
        bounded_subgraph(
            "r",
            [n("r"), n("a"), n("b")],
            [e("dup", "r", "a"), e("dup", "r", "b")],
        )


def test_same_id_distinct_endpoints_reversed_raises() -> None:
    with pytest.raises(ValueError, match=EDGE_ID_CONFLICT):
        bounded_subgraph(
            "r",
            [n("r"), n("a"), n("b")],
            [e("dup", "r", "b"), e("dup", "r", "a")],
        )


def test_conflict_error_message_is_stable_across_input_order() -> None:
    forward_edges = [e("dup", "r", "a"), e("dup", "r", "b")]
    reverse_edges = [e("dup", "r", "b"), e("dup", "r", "a")]
    nodes = [n("r"), n("a"), n("b")]

    with pytest.raises(ValueError) as forward_exc:
        bounded_subgraph("r", nodes, forward_edges)
    with pytest.raises(ValueError) as reverse_exc:
        bounded_subgraph("r", nodes, reverse_edges)

    assert isinstance(forward_exc.value, ValueError)
    assert isinstance(reverse_exc.value, ValueError)
    assert str(forward_exc.value) == str(reverse_exc.value)
    # Sorted pairs appear in the message, independent of order.
    assert "('a', 'r')" in str(forward_exc.value)
    assert "('b', 'r')" in str(forward_exc.value)


def test_conflict_takes_precedence_over_dangling() -> None:
    # The conflicting edge id 'dup' joins r-a and r-b; b is also a dangling
    # node here. The conflict must surface regardless of order, never the
    # dangling check -- proving input order cannot change the validation result.
    nodes = [n("r"), n("a")]  # b is absent -> dangling for the r-b edge
    with pytest.raises(ValueError, match=EDGE_ID_CONFLICT):
        bounded_subgraph("r", nodes, [e("dup", "r", "a"), e("dup", "r", "b")])
    with pytest.raises(ValueError, match=EDGE_ID_CONFLICT):
        bounded_subgraph("r", nodes, [e("dup", "r", "b"), e("dup", "r", "a")])


# --------------------------------------------------------------------------- #
# Determinism
# --------------------------------------------------------------------------- #


def test_output_independent_of_input_order() -> None:
    base_nodes = [n("r"), n("a"), n("b"), n("c")]
    base_edges = [
        e("e1", "r", "a"),
        e("e2", "a", "b"),
        e("e3", "b", "c"),
        e("e4", "r", "c"),
    ]

    forward = bounded_subgraph("r", base_nodes, base_edges)
    reverse_nodes = list(reversed(base_nodes))
    reverse_edges = list(reversed(base_edges))
    reversed_ = bounded_subgraph("r", reverse_nodes, reverse_edges)

    assert forward == reversed_
    # Stable node ordering even when r is supplied last.
    assert [node.id for node in forward.nodes] == ["a", "b", "c", "r"]
    assert [edge.id for edge in forward.edges] == ["e1", "e2", "e3", "e4"]


def test_parallel_edges_with_distinct_ids_kept() -> None:
    # Same endpoints, different ids -> genuinely distinct edges, both kept.
    result = bounded_subgraph(
        "r",
        [n("r"), n("a")],
        [e("p1", "r", "a"), e("p2", "r", "a")],
    )

    assert [edge.id for edge in result.edges] == ["p1", "p2"]


# --------------------------------------------------------------------------- #
# Truncation
# --------------------------------------------------------------------------- #


def test_node_cap_truncates_at_limit() -> None:
    # Star: root connects to many leaves; one hop, but > max_nodes nodes total.
    leaf_ids = [f"leaf{i}" for i in range(HARD_MAX_NODES)]  # 150 leaves + root = 151
    nodes = [n("r"), *(n(leaf_id) for leaf_id in leaf_ids)]
    edges = [e(f"e{i}", "r", leaf_id) for i, leaf_id in enumerate(leaf_ids)]

    result = bounded_subgraph("r", nodes, edges)

    assert len(result.nodes) == HARD_MAX_NODES
    assert result.truncated is True
    assert result.truncation_reasons == frozenset({TruncationReason.MAX_NODES})


def test_node_cap_lower_limit_respected() -> None:
    nodes = [n("r"), n("a"), n("b"), n("c")]
    edges = [e("e1", "r", "a"), e("e2", "a", "b"), e("e3", "b", "c")]

    result = bounded_subgraph("r", nodes, edges, max_nodes=2)

    assert len(result.nodes) == 2
    assert result.truncated is True
    assert TruncationReason.MAX_NODES in result.truncation_reasons


def test_edge_cap_truncates_at_limit() -> None:
    # Fully connected small graph with > max_edges edges among visited nodes.
    size = 30  # size*(size-1)/2 = 435 > 400
    ids = [f"n{i}" for i in range(size)]
    nodes = [n(node_id) for node_id in ids]
    edges = [e(f"e{i}_{j}", ids[i], ids[j]) for i in range(size) for j in range(i + 1, size)]

    result = bounded_subgraph("n0", nodes, edges)

    assert len(result.edges) == HARD_MAX_EDGES
    assert result.truncated is True
    assert result.truncation_reasons == frozenset({TruncationReason.MAX_EDGES})


def test_edge_cap_lower_limit_respected() -> None:
    # Ring of 4 -> 4 edges among visited (all within 2 hops of r); cap at 2.
    nodes = [n("r"), n("a"), n("b"), n("c")]
    edges = [
        e("e1", "r", "a"),
        e("e2", "a", "b"),
        e("e3", "b", "c"),
        e("e4", "c", "r"),
    ]

    result = bounded_subgraph("r", nodes, edges, max_edges=2)

    assert len(result.edges) == 2
    assert result.truncated is True
    assert TruncationReason.MAX_EDGES in result.truncation_reasons


def test_node_and_edge_caps_reached_simultaneously() -> None:
    # Build a graph where nodes and edges limit independently:
    #   - many leaves on root (one hop) so reachable nodes exceed max_nodes;
    #   - a dense clique among the *first* few leaves (which are the visited
    #     ones) so induced edges among visited nodes also exceed max_edges.
    leaf_count = HARD_MAX_NODES  # + root = HARD_MAX_NODES + 1 reachable
    leaf_ids = [f"leaf{i}" for i in range(leaf_count)]
    nodes = [n("r"), *(n(leaf_id) for leaf_id in leaf_ids)]
    edges: list[GraphEdge] = [e(f"star{i}", "r", leaf_id) for i, leaf_id in enumerate(leaf_ids)]
    # Clique among the visited leaves (first HARD_MAX_NODES-1 leaves are
    # visited alongside root, before the node cap bites).
    visited_leaves = leaf_ids[: HARD_MAX_NODES - 1]
    clique_edges = [
        e(f"c{i}_{j}", visited_leaves[i], visited_leaves[j])
        for i in range(len(visited_leaves))
        for j in range(i + 1, len(visited_leaves))
    ]
    edges.extend(clique_edges)

    result = bounded_subgraph("r", nodes, edges, max_edges=10)

    assert len(result.nodes) == HARD_MAX_NODES  # node cap active

    assert len(result.edges) == 10  # edge cap active
    assert result.truncated is True
    assert result.truncation_reasons == frozenset(
        {TruncationReason.MAX_NODES, TruncationReason.MAX_EDGES}
    )


def test_not_truncated_when_exactly_at_limit() -> None:
    # Exactly max_nodes reachable -> no truncation.
    leaf_ids = [f"leaf{i}" for i in range(HARD_MAX_NODES - 1)]  # + root = 150
    nodes = [n("r"), *(n(leaf_id) for leaf_id in leaf_ids)]
    edges = [e(f"e{i}", "r", leaf_id) for i, leaf_id in enumerate(leaf_ids)]

    result = bounded_subgraph("r", nodes, edges)

    assert len(result.nodes) == HARD_MAX_NODES
    assert len(result.edges) == HARD_MAX_NODES - 1
    assert result.truncated is False


# --------------------------------------------------------------------------- #
# Error handling
# --------------------------------------------------------------------------- #


def test_missing_root_raises_value_error() -> None:
    with pytest.raises(ValueError, match="root id"):
        bounded_subgraph("ghost", [n("r"), n("a")], [e("e1", "r", "a")])


def test_dangling_edge_source_raises() -> None:
    # Root r and target a are both present; only the edge source ghost is absent.
    with pytest.raises(ValueError, match="unknown node"):
        bounded_subgraph("r", [n("r"), n("a")], [e("e1", "ghost", "a")])


def test_dangling_edge_target_raises() -> None:
    # Root r is present, but edge target a is not in the node set.
    with pytest.raises(ValueError, match="unknown node"):
        bounded_subgraph("r", [n("r")], [e("e1", "r", "a")])


@pytest.mark.parametrize("bad_hops", [0, 3, -1, 5])
def test_invalid_max_hops_raises(bad_hops: int) -> None:
    with pytest.raises(ValueError, match="max_hops"):
        bounded_subgraph("r", [n("r")], [], max_hops=bad_hops)


def test_invalid_max_nodes_zero_raises() -> None:
    with pytest.raises(ValueError, match="max_nodes"):
        bounded_subgraph("r", [n("r")], [], max_nodes=0)


def test_invalid_max_nodes_above_hard_raises() -> None:
    with pytest.raises(ValueError, match="max_nodes"):
        bounded_subgraph("r", [n("r")], [], max_nodes=HARD_MAX_NODES + 1)


def test_invalid_max_edges_zero_raises() -> None:
    with pytest.raises(ValueError, match="max_edges"):
        bounded_subgraph("r", [n("r")], [], max_edges=0)


def test_invalid_max_edges_above_hard_raises() -> None:
    with pytest.raises(ValueError, match="max_edges"):
        bounded_subgraph("r", [n("r")], [], max_edges=HARD_MAX_EDGES + 1)


def test_boolean_limits_rejected() -> None:
    # bool is a subclass of int; True would equal 1 and be silently accepted.
    with pytest.raises(ValueError, match="max_hops"):
        bounded_subgraph("r", [n("r")], [], max_hops=True)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# Large / deep / wide inputs terminate
# --------------------------------------------------------------------------- #


def test_super_deep_chain_terminates_within_two_hops() -> None:
    # A chain far deeper than two hops: only the first two nodes are reached,
    # proving deep structure does not pull the traversal along.
    ids = [f"deep{i}" for i in range(10_000)]
    nodes = [n(node_id) for node_id in ids]
    edges = [e(f"e{i}", ids[i], ids[i + 1]) for i in range(len(ids) - 1)]

    result = bounded_subgraph("deep0", nodes, edges)

    assert {node.id for node in result.nodes} == {"deep0", "deep1", "deep2"}
    assert result.hops_reached == 2
    assert result.truncated is False


def test_super_wide_star_terminates_and_truncates() -> None:
    # Root with a huge neighbour fan-out, but capped so traversal ends quickly.
    leaf_ids = [f"wide{i}" for i in range(20_000)]
    nodes = [n("r"), *(n(leaf_id) for leaf_id in leaf_ids)]
    edges = [e(f"e{i}", "r", leaf_id) for i, leaf_id in enumerate(leaf_ids)]

    result = bounded_subgraph("r", nodes, edges)

    assert len(result.nodes) == HARD_MAX_NODES
    assert result.truncated is True
    assert TruncationReason.MAX_NODES in result.truncation_reasons


def test_high_degree_node_with_self_loops_terminates() -> None:
    # Pathological: every node has a self-loop plus a long chain forward.
    ids = [f"wide{i}" for i in range(5_000)]
    nodes = [n(node_id) for node_id in ids]
    edges = [e(f"self{i}", node_id, node_id) for i, node_id in enumerate(ids)]
    edges.extend(e(f"chain{i}", ids[i], ids[i + 1]) for i in range(len(ids) - 1))

    result = bounded_subgraph("wide0", nodes, edges)

    assert {node.id for node in result.nodes} == {"wide0", "wide1", "wide2"}
    assert result.hops_reached == 2


# --------------------------------------------------------------------------- #
# Package-level defaults
# --------------------------------------------------------------------------- #


def test_default_max_hops_constant() -> None:
    assert DEFAULT_MAX_HOPS == 2


def test_hard_limits_constants() -> None:
    assert HARD_MAX_NODES == 150
    assert HARD_MAX_EDGES == 400


def test_edge_is_induced_by_visited_nodes() -> None:
    # Edge to a two-hop-away node whose only path is two hops should NOT appear
    # until both endpoints are visited. Here both are visited (2 hops), so it
    # appears; an edge to a 3-hop node is excluded entirely.
    result = bounded_subgraph(
        "r",
        [n("r"), n("a"), n("b"), n("c")],
        [
            e("e1", "r", "a"),
            e("e2", "a", "b"),
            e("e3", "b", "c"),  # both b(2-hop) and c(3-hop) -> excluded
        ],
    )

    assert {node.id for node in result.nodes} == {"r", "a", "b"}
    assert [edge.id for edge in result.edges] == ["e1", "e2"]


def test_result_type_is_bounded_subgraph() -> None:
    result = bounded_subgraph("r", [n("r")], [])
    assert isinstance(result, BoundedSubgraph)
