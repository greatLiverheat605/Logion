export interface SelfStudyEntityInput {
  id: string;
  parentId?: string | null;
}

export function buildSelfStudySummary({
  deliverables,
  projects,
  tracks,
}: {
  deliverables: readonly SelfStudyEntityInput[];
  projects: readonly SelfStudyEntityInput[];
  tracks: readonly SelfStudyEntityInput[];
}) {
  const trackIds = new Set(tracks.map((track) => track.id));
  const linkedProjects = projects.filter(
    (project) => project.parentId && trackIds.has(project.parentId),
  );
  const projectIds = new Set(linkedProjects.map((project) => project.id));
  const linkedDeliverables = deliverables.filter(
    (deliverable) =>
      deliverable.parentId && projectIds.has(deliverable.parentId),
  );
  const projectsWithDeliverables = new Set(
    linkedDeliverables.map((deliverable) => deliverable.parentId),
  ).size;

  return {
    deliverableCount: linkedDeliverables.length,
    orphanProjectCount: projects.length - linkedProjects.length,
    projectCount: linkedProjects.length,
    projectCoverage:
      linkedProjects.length === 0
        ? null
        : (projectsWithDeliverables / linkedProjects.length) * 100,
    trackCount: tracks.length,
  };
}
