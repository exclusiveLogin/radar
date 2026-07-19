import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames legacy JSONB keys in job_track_rebuild.stats.
 * phase* becomes step*, dedupClosureSize becomes candidateWindowSize, and stages become cluster/join.
 */
export class TrackingRebuildStatsKeyRename1753200000000 implements MigrationInterface {
  name = "TrackingRebuildStatsKeyRename1753200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE job_track_rebuild
      SET stats = (
        (
          stats
          - 'phaseStats'
          - 'dedupClosureSize'
          - 'phase2PairsConsidered'
          - 'phase2PairsAccepted'
          - 'phase2PairsRejectedByKinematics'
          - 'phase2ReliabilityAvg'
          - 'phase2ReliabilityP95'
          - 'phase3LinksConsidered'
          - 'phase3LinksAccepted'
          - 'phase3NodesSeeded'
          - 'phase3RejectGap'
          - 'phase3RejectDistance'
          - 'phase3RejectVelocity'
          - 'phase3RejectCounterFlow'
          - 'phase3RejectTurn'
          - 'phase3RejectKalmanInnovation'
        )
        || jsonb_strip_nulls(jsonb_build_object(
          'stepStats', COALESCE(stats->'stepStats', stats->'phaseStats'),
          'candidateWindowSize', COALESCE(stats->'candidateWindowSize', stats->'dedupClosureSize'),
          'step2PairsConsidered', COALESCE(stats->'step2PairsConsidered', stats->'phase2PairsConsidered'),
          'step2PairsAccepted', COALESCE(stats->'step2PairsAccepted', stats->'phase2PairsAccepted'),
          'step2PairsRejectedByKinematics', COALESCE(stats->'step2PairsRejectedByKinematics', stats->'phase2PairsRejectedByKinematics'),
          'step2ReliabilityAvg', COALESCE(stats->'step2ReliabilityAvg', stats->'phase2ReliabilityAvg'),
          'step2ReliabilityP95', COALESCE(stats->'step2ReliabilityP95', stats->'phase2ReliabilityP95'),
          'step3LinksConsidered', COALESCE(stats->'step3LinksConsidered', stats->'phase3LinksConsidered'),
          'step3LinksAccepted', COALESCE(stats->'step3LinksAccepted', stats->'phase3LinksAccepted'),
          'step3NodesSeeded', COALESCE(stats->'step3NodesSeeded', stats->'phase3NodesSeeded'),
          'step3RejectGap', COALESCE(stats->'step3RejectGap', stats->'phase3RejectGap'),
          'step3RejectDistance', COALESCE(stats->'step3RejectDistance', stats->'phase3RejectDistance'),
          'step3RejectVelocity', COALESCE(stats->'step3RejectVelocity', stats->'phase3RejectVelocity'),
          'step3RejectCounterFlow', COALESCE(stats->'step3RejectCounterFlow', stats->'phase3RejectCounterFlow'),
          'step3RejectTurn', COALESCE(stats->'step3RejectTurn', stats->'phase3RejectTurn'),
          'step3RejectKalmanInnovation', COALESCE(stats->'step3RejectKalmanInnovation', stats->'phase3RejectKalmanInnovation')
        ))
        || CASE
             WHEN stats->>'stage' = 'stdbscan' THEN '{"stage":"cluster"}'::jsonb
             WHEN stats->>'stage' = 'kalman' THEN '{"stage":"join"}'::jsonb
             ELSE '{}'::jsonb
           END
      )
      WHERE
        stats ?| ARRAY[
          'phaseStats',
          'dedupClosureSize',
          'phase2PairsConsidered',
          'phase2PairsAccepted',
          'phase2PairsRejectedByKinematics',
          'phase2ReliabilityAvg',
          'phase2ReliabilityP95',
          'phase3LinksConsidered',
          'phase3LinksAccepted',
          'phase3NodesSeeded',
          'phase3RejectGap',
          'phase3RejectDistance',
          'phase3RejectVelocity',
          'phase3RejectCounterFlow',
          'phase3RejectTurn',
          'phase3RejectKalmanInnovation'
        ]
        OR stats->>'stage' IN ('stdbscan', 'kalman')
    `);
  }

  /** Reverts stage names for legacy rebuild runs. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE job_track_rebuild
      SET stats = (
        (
          stats
          - 'stepStats'
          - 'candidateWindowSize'
          - 'step2PairsConsidered'
          - 'step2PairsAccepted'
          - 'step2PairsRejectedByKinematics'
          - 'step2ReliabilityAvg'
          - 'step2ReliabilityP95'
          - 'step3LinksConsidered'
          - 'step3LinksAccepted'
          - 'step3NodesSeeded'
          - 'step3RejectGap'
          - 'step3RejectDistance'
          - 'step3RejectVelocity'
          - 'step3RejectCounterFlow'
          - 'step3RejectTurn'
          - 'step3RejectKalmanInnovation'
        )
        || jsonb_strip_nulls(jsonb_build_object(
          'phaseStats', COALESCE(stats->'phaseStats', stats->'stepStats'),
          'dedupClosureSize', COALESCE(stats->'dedupClosureSize', stats->'candidateWindowSize'),
          'phase2PairsConsidered', COALESCE(stats->'phase2PairsConsidered', stats->'step2PairsConsidered'),
          'phase2PairsAccepted', COALESCE(stats->'phase2PairsAccepted', stats->'step2PairsAccepted'),
          'phase2PairsRejectedByKinematics', COALESCE(stats->'phase2PairsRejectedByKinematics', stats->'step2PairsRejectedByKinematics'),
          'phase2ReliabilityAvg', COALESCE(stats->'phase2ReliabilityAvg', stats->'step2ReliabilityAvg'),
          'phase2ReliabilityP95', COALESCE(stats->'phase2ReliabilityP95', stats->'step2ReliabilityP95'),
          'phase3LinksConsidered', COALESCE(stats->'phase3LinksConsidered', stats->'step3LinksConsidered'),
          'phase3LinksAccepted', COALESCE(stats->'phase3LinksAccepted', stats->'step3LinksAccepted'),
          'phase3NodesSeeded', COALESCE(stats->'phase3NodesSeeded', stats->'step3NodesSeeded'),
          'phase3RejectGap', COALESCE(stats->'phase3RejectGap', stats->'step3RejectGap'),
          'phase3RejectDistance', COALESCE(stats->'phase3RejectDistance', stats->'step3RejectDistance'),
          'phase3RejectVelocity', COALESCE(stats->'phase3RejectVelocity', stats->'step3RejectVelocity'),
          'phase3RejectCounterFlow', COALESCE(stats->'phase3RejectCounterFlow', stats->'step3RejectCounterFlow'),
          'phase3RejectTurn', COALESCE(stats->'phase3RejectTurn', stats->'step3RejectTurn'),
          'phase3RejectKalmanInnovation', COALESCE(stats->'phase3RejectKalmanInnovation', stats->'step3RejectKalmanInnovation')
        ))
      )
      WHERE stats ?| ARRAY[
        'stepStats',
        'candidateWindowSize',
        'step2PairsConsidered',
        'step2PairsAccepted',
        'step2PairsRejectedByKinematics',
        'step2ReliabilityAvg',
        'step2ReliabilityP95',
        'step3LinksConsidered',
        'step3LinksAccepted',
        'step3NodesSeeded',
        'step3RejectGap',
        'step3RejectDistance',
        'step3RejectVelocity',
        'step3RejectCounterFlow',
        'step3RejectTurn',
        'step3RejectKalmanInnovation'
      ]
    `);
  }
}
