/* ============================================================
   knowledge-space-prototype / mock-data.ts
   Local static mock data for both prototype variants.
   No API calls, no backend assumptions.
   ============================================================ */

export type EvidenceStatus =
  | "suggested"
  | "accepted"
  | "rejected"
  | "pending_review";

export type ProjectionSlot = "today" | "review" | "records";

export interface EvidenceItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  status: EvidenceStatus;
  suggestedAt: string; // ISO date
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  tags: string[];
  confidence: number; // 0-1
  /** Whether this item requires an online connection to view */
  onlineOnly: boolean;
  /** When true, the item is locked (e.g. encryption, permissions) */
  locked: boolean;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: "concept" | "evidence" | "source" | "claim";
  /** How many accepted evidence items are connected */
  acceptedCount: number;
  /** How many suggested items are pending */
  suggestedCount: number;
  children: string[]; // node ids
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  label: string;
  status: EvidenceStatus;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ProjectionData {
  evidence: EvidenceItem[];
  graph: KnowledgeGraph;
  messages: Message[];
  progress: {
    total: number;
    accepted: number;
    suggested: number;
    rejected: number;
  };
}

/* ---------- helper factories ---------- */

const now = "2026-08-04T10:00:00Z";

function daysAgo(n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/* ---------- evidence items ---------- */

const sharedEvidence: EvidenceItem[] = [
  {
    id: "ev-001",
    title: "Spaced Repetition Effectiveness Meta-Analysis",
    summary:
      "A 2025 meta-analysis of 47 studies confirms that spaced repetition improves long-term retention by 72% compared to massed practice, with effect sizes remaining robust across age groups and subject domains.",
    source: "Journal of Cognitive Psychology, 2025",
    sourceUrl: "https://example.com/study-001",
    status: "accepted",
    suggestedAt: daysAgo(14),
    acceptedAt: daysAgo(10),
    rejectedAt: null,
    rejectReason: null,
    tags: ["spaced-repetition", "meta-analysis", "retention"],
    confidence: 0.92,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-002",
    title: "Active Recall vs. Passive Review",
    summary:
      "Active recall testing produces 50% better long-term retention than passive review sessions, according to a randomized controlled trial with 1,200 participants over 6 months.",
    source: "Nature Human Behaviour, 2026",
    sourceUrl: "https://example.com/study-002",
    status: "accepted",
    suggestedAt: daysAgo(12),
    acceptedAt: daysAgo(8),
    rejectedAt: null,
    rejectReason: null,
    tags: ["active-recall", "testing-effect", "retention"],
    confidence: 0.88,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-003",
    title: "Interleaving Practice in Mathematics",
    summary:
      "Interleaving practice problems across topics yields 25% higher exam scores than blocked practice, though students report higher initial difficulty.",
    source: "Educational Psychology Review, 2024",
    sourceUrl: "https://example.com/study-003",
    status: "accepted",
    suggestedAt: daysAgo(10),
    acceptedAt: daysAgo(6),
    rejectedAt: null,
    rejectReason: null,
    tags: ["interleaving", "mathematics", "practice"],
    confidence: 0.85,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-004",
    title: "Sleep Consolidation and Memory",
    summary:
      "Sleep within 12 hours of learning significantly increases memory consolidation. The effect is strongest for declarative memory tasks.",
    source: "Sleep Research Society, 2025",
    sourceUrl: "https://example.com/study-004",
    status: "suggested",
    suggestedAt: daysAgo(3),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["sleep", "consolidation", "declarative-memory"],
    confidence: 0.76,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-005",
    title: "Dual Coding Theory Applied to Language Learning",
    summary:
      "Combining verbal and visual information during language learning increases vocabulary retention by 35% compared to verbal-only methods.",
    source: "Applied Linguistics, 2026",
    sourceUrl: "https://example.com/study-005",
    status: "suggested",
    suggestedAt: daysAgo(2),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["dual-coding", "language-learning", "vocabulary"],
    confidence: 0.71,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-006",
    title: "Cognitive Load Theory in Instructional Design",
    summary:
      "This paper proposes a revised model of cognitive load that distinguishes between intrinsic, extraneous, and germane load. The revision has been criticised for lack of empirical support.",
    source: "Pre-print, arXiv:2603.12345",
    sourceUrl: "https://example.com/preprint-006",
    status: "rejected",
    suggestedAt: daysAgo(20),
    acceptedAt: null,
    rejectedAt: daysAgo(15),
    rejectReason:
      "Pre-print claims lack empirical support; methodology concerns.",
    tags: ["cognitive-load", "instructional-design", "pre-print"],
    confidence: 0.45,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-007",
    title: "Retrieval Practice in Medical Education",
    summary:
      "Medical students who used retrieval practice scored 32% higher on board exams. However, the study only measures short-term outcomes.",
    source: "Medical Education Journal, 2025",
    sourceUrl: "https://example.com/study-007",
    status: "suggested",
    suggestedAt: daysAgo(1),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["retrieval-practice", "medical-education", "exam-performance"],
    confidence: 0.62,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-008",
    title: "Encrypted Learning Analytics Dataset",
    summary:
      "Differential privacy guarantees for student learning data. This dataset requires key-based decryption.",
    source: "Private Dataset · Institutional Access Only",
    sourceUrl: "https://example.com/private-dataset-008",
    status: "suggested",
    suggestedAt: daysAgo(5),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["privacy", "differential-privacy", "analytics"],
    confidence: 0.58,
    onlineOnly: true,
    locked: true,
  },
  {
    id: "ev-009",
    title: "Gamification and Motivation in Self-Directed Learning",
    summary:
      "Gamification elements increase extrinsic motivation but may undermine intrinsic motivation over periods longer than 12 weeks.",
    source: "Computers & Education, 2026",
    sourceUrl: "https://example.com/study-009",
    status: "pending_review",
    suggestedAt: daysAgo(0),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["gamification", "motivation", "self-directed-learning"],
    confidence: 0.68,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-010",
    title: "Knowledge Graph Embeddings for Scientific Literature",
    summary:
      "A novel approach to embedding scientific literature into knowledge graphs achieves state-of-the-art link prediction on 3 benchmark datasets.",
    source: "NeurIPS 2025",
    sourceUrl: "https://example.com/neurips-010",
    status: "suggested",
    suggestedAt: daysAgo(4),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["knowledge-graphs", "embeddings", "link-prediction"],
    confidence: 0.81,
    onlineOnly: true,
    locked: false,
  },
  {
    id: "ev-011",
    title: "Desirable Difficulties Framework",
    summary:
      "Introducing manageable difficulties during learning—such as varying conditions, spacing, and interleaving—enhances long-term retention despite slowing initial acquisition. Foundational framework paper.",
    source: "Journal of Applied Research in Memory and Cognition, 2024",
    sourceUrl: "https://example.com/study-011",
    status: "accepted",
    suggestedAt: daysAgo(30),
    acceptedAt: daysAgo(25),
    rejectedAt: null,
    rejectReason: null,
    tags: ["desirable-difficulties", "framework", "retention"],
    confidence: 0.94,
    onlineOnly: false,
    locked: false,
  },
  {
    id: "ev-012",
    title: "AI-Generated Summaries for Peer Review",
    summary:
      "Large language models can generate usable peer review summaries, but human oversight remains essential for accuracy and fairness.",
    source: "Nature Machine Intelligence, 2026",
    sourceUrl: "https://example.com/study-012",
    status: "suggested",
    suggestedAt: daysAgo(1),
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    tags: ["ai", "peer-review", "summarization"],
    confidence: 0.73,
    onlineOnly: false,
    locked: false,
  },
];

/* ---------- knowledge graph ---------- */

const sharedGraph: KnowledgeGraph = {
  nodes: [
    {
      id: "concept-1",
      label: "Learning Science",
      type: "concept",
      acceptedCount: 4,
      suggestedCount: 3,
      children: ["concept-2", "concept-3", "concept-4"],
    },
    {
      id: "concept-2",
      label: "Retention Strategies",
      type: "concept",
      acceptedCount: 3,
      suggestedCount: 1,
      children: ["ev-001", "ev-002", "ev-011"],
    },
    {
      id: "concept-3",
      label: "Practice Methods",
      type: "concept",
      acceptedCount: 2,
      suggestedCount: 2,
      children: ["ev-003", "ev-007"],
    },
    {
      id: "concept-4",
      label: "Cognitive Science",
      type: "concept",
      acceptedCount: 1,
      suggestedCount: 3,
      children: ["ev-004", "ev-006", "ev-009"],
    },
    {
      id: "ev-001",
      label: "Spaced Repetition Meta-Analysis",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-002",
      label: "Active Recall Study",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-003",
      label: "Interleaving Math",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-004",
      label: "Sleep Consolidation",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-006",
      label: "Cognitive Load Pre-print",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-007",
      label: "Retrieval Practice Med",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-009",
      label: "Gamification Motivation",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "ev-011",
      label: "Desirable Difficulties",
      type: "evidence",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "source-1",
      label: "Journal of Cognitive Psychology",
      type: "source",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
    {
      id: "claim-1",
      label: "Spaced repetition > massed practice",
      type: "claim",
      acceptedCount: 0,
      suggestedCount: 0,
      children: [],
    },
  ],
  edges: [
    {
      source: "concept-1",
      target: "concept-2",
      label: "includes",
      status: "accepted",
    },
    {
      source: "concept-1",
      target: "concept-3",
      label: "includes",
      status: "accepted",
    },
    {
      source: "concept-1",
      target: "concept-4",
      label: "includes",
      status: "accepted",
    },
    {
      source: "concept-2",
      target: "ev-001",
      label: "supports",
      status: "accepted",
    },
    {
      source: "concept-2",
      target: "ev-002",
      label: "supports",
      status: "accepted",
    },
    {
      source: "concept-2",
      target: "ev-011",
      label: "supports",
      status: "accepted",
    },
    {
      source: "concept-3",
      target: "ev-003",
      label: "supports",
      status: "accepted",
    },
    {
      source: "concept-3",
      target: "ev-007",
      label: "supports",
      status: "suggested",
    },
    {
      source: "concept-4",
      target: "ev-004",
      label: "supports",
      status: "suggested",
    },
    {
      source: "concept-4",
      target: "ev-006",
      label: "supports",
      status: "rejected",
    },
    {
      source: "concept-4",
      target: "ev-009",
      label: "supports",
      status: "suggested",
    },
    {
      source: "ev-001",
      target: "source-1",
      label: "published_in",
      status: "accepted",
    },
    {
      source: "ev-001",
      target: "claim-1",
      label: "supports",
      status: "accepted",
    },
  ],
};

/* ---------- messages ---------- */

const sharedMessages: Message[] = [
  {
    id: "msg-1",
    role: "user",
    content:
      "What does the research say about spaced repetition vs. massed practice?",
    timestamp: daysAgo(14),
  },
  {
    id: "msg-2",
    role: "assistant",
    content:
      "A 2025 meta-analysis of 47 studies found that spaced repetition improves long-term retention by 72% compared to massed practice. The effect is robust across age groups and subject domains. Would you like me to elaborate on specific study designs?",
    timestamp: daysAgo(14),
  },
  {
    id: "msg-3",
    role: "user",
    content: "Yes, please include the key moderators.",
    timestamp: daysAgo(13),
  },
  {
    id: "msg-4",
    role: "assistant",
    content:
      "The meta-analysis identified three key moderators: (1) retention interval — benefits are larger at >7 day delays; (2) test format — free recall benefits more than recognition; (3) age — effect size is stable from childhood through older adulthood. I've added these details to the evidence log.",
    timestamp: daysAgo(13),
  },
  {
    id: "msg-5",
    role: "user",
    content: "What about interleaving in math learning?",
    timestamp: daysAgo(10),
  },
  {
    id: "msg-6",
    role: "assistant",
    content:
      "Interleaving practice across math topics yields 25% higher exam scores than blocked practice. Students report it feels harder initially, but this 'desirable difficulty' is precisely what drives deeper learning. The effect is strongest for procedural vs. conceptual knowledge.",
    timestamp: daysAgo(10),
  },
];

/* ---------- per-projection evidence filters ---------- */

function projectionEvidence(
  slot: ProjectionSlot,
  all: EvidenceItem[],
): EvidenceItem[] {
  switch (slot) {
    case "today":
      // Most recent items, focus on what needs action today
      return all.filter(
        (e) => e.status === "suggested" || e.status === "pending_review",
      );
    case "review":
      // Items pending review, plus recently accepted/rejected
      return all.filter(
        (e) => e.status === "pending_review" || e.status === "suggested",
      );
    case "records":
      // All items with full status visibility
      return [...all].sort(
        (a, b) =>
          new Date(b.suggestedAt).getTime() - new Date(a.suggestedAt).getTime(),
      );
  }
}

/* ---------- progress helper ---------- */

function computeProgress(items: EvidenceItem[]): ProjectionData["progress"] {
  const total = items.length;
  const accepted = items.filter((e) => e.status === "accepted").length;
  const suggested = items.filter(
    (e) => e.status === "suggested" || e.status === "pending_review",
  ).length;
  const rejected = items.filter((e) => e.status === "rejected").length;
  return { total, accepted, suggested, rejected };
}

/* ---------- public API ---------- */

export function getProjectionData(slot: ProjectionSlot): ProjectionData {
  const evidence = projectionEvidence(slot, sharedEvidence);
  return {
    evidence,
    graph: sharedGraph,
    messages: sharedMessages,
    progress: computeProgress(evidence),
  };
}

export function getAllEvidence(): EvidenceItem[] {
  return [...sharedEvidence];
}
