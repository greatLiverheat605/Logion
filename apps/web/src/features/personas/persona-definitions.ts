export type BuiltinPersonaId = "exam" | "self" | "research" | "mentor";
export type PersonaId = BuiltinPersonaId | `custom-${string}`;

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  icon: string;
  description: string;
  routes: string[];
  isBuiltin: boolean;
}

export const ALL_ROUTES = [
  "/app/today",
  "/app/self-study",
  "/app/records",
  "/app/review",
  "/app/exam",
  "/app/planning",
  "/app/templates",
  "/app/audit",
  "/app/spaces",
  "/app/settings",
  "/app/profile",
  "/app/help",
] as const;

export const REQUIRED_PERSONA_ROUTES = [
  "/app/today",
  "/app/settings",
  "/app/profile",
  "/app/help",
] as const;

export const DEFAULT_PERSONA: PersonaDefinition = {
  id: "self",
  name: "学",
  icon: "📚",
  description: "自主学习：每日目标、学习记录、个人计划",
  routes: [
    "/app/today",
    "/app/self-study",
    "/app/records",
    "/app/planning",
    "/app/templates",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
  isBuiltin: true,
};

export const BUILTIN_PERSONAS: readonly PersonaDefinition[] = [
  {
    id: "exam",
    name: "考",
    icon: "📝",
    description: "应试学习：刷题、错题、模拟考",
    routes: [
      "/app/today",
      "/app/exam",
      "/app/review",
      "/app/records",
      "/app/settings",
      "/app/profile",
      "/app/help",
    ],
    isBuiltin: true,
  },
  DEFAULT_PERSONA,
  {
    id: "research",
    name: "研",
    icon: "🔬",
    description: "学术研究：知识图谱、文献管理、研究声明",
    routes: [
      "/app/today",
      "/app/self-study",
      "/app/records",
      "/app/review",
      "/app/planning",
      "/app/templates",
      "/app/settings",
      "/app/profile",
      "/app/help",
    ],
    isBuiltin: true,
  },
  {
    id: "mentor",
    name: "导",
    icon: "👥",
    description: "团队协作：工作区管理、审计、成员协作",
    routes: [
      "/app/today",
      "/app/self-study",
      "/app/planning",
      "/app/templates",
      "/app/audit",
      "/app/spaces",
      "/app/settings",
      "/app/profile",
      "/app/help",
    ],
    isBuiltin: true,
  },
];
