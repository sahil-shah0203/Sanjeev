import type { PoolClient } from "pg";

/** A duplicate archive is a valid donor only within the same owner's exact package hash. */
export async function mediaRecoveryCandidates(
  db: Pick<PoolClient, "query">,
  owner: string,
  namespace: string,
  names: string[],
) {
  return (
    await db.query(
      `
    WITH requested_import AS (
      SELECT value->>'hash' package_hash FROM public.documents
      WHERE owner_id=$1 AND entity='imports' AND NOT deleted AND value->>'namespace'=$2
        AND value->>'hash' ~ '^[a-f0-9]{64}$'
    )
    SELECT DISTINCT ON (m.name) m.*, target.id target_id, target.complete target_complete
    FROM public.media_assets m
    JOIN public.documents donor ON donor.owner_id=m.owner_id AND donor.entity='imports'
      AND NOT donor.deleted AND donor.value->>'namespace'=m.namespace::text
    JOIN requested_import requested ON requested.package_hash=donor.value->>'hash'
    LEFT JOIN public.media_assets target ON target.owner_id=$1 AND target.namespace::text=$2 AND target.name=m.name
    WHERE m.owner_id=$1 AND m.complete AND m.name=ANY($3::text[])
      AND (target.hash IS NULL OR target.hash=m.hash)
    ORDER BY m.name,(m.namespace::text=$2) DESC
  `,
      [owner, namespace, names],
    )
  ).rows;
}
