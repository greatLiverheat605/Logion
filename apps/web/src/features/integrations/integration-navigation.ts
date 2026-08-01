import type {
  BuiltinPersonaId,
  PersonaDefinition,
} from "@/features/personas/persona-definitions";

export const INTEGRATION_ENTRY_PERSONAS: readonly BuiltinPersonaId[] = [
  "self",
  "research",
  "mentor",
];

export function isIntegrationEntryVisible(
  persona: PersonaDefinition | null,
): boolean {
  return Boolean(
    persona?.isBuiltin &&
    INTEGRATION_ENTRY_PERSONAS.includes(persona.id as BuiltinPersonaId),
  );
}
