-- Versioned enrichment is independent of chain snapshot generation.
CREATE TABLE quantum_v2.enrichment_revision (
    revision text PRIMARY KEY,
    source text NOT NULL,
    source_sha256 text NOT NULL CHECK(length(source_sha256)=64),
    kind text NOT NULL CHECK(kind IN ('legacy-snapshot','curated')),
    imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quantum_v2.attribution (
    revision text NOT NULL REFERENCES quantum_v2.enrichment_revision(revision),
    subject_id text NOT NULL,
    identity text NOT NULL DEFAULT '',
    details text NOT NULL DEFAULT '',
    details_quality text NOT NULL CHECK(details_quality IN ('legacy-annotation','verified-policy','curated')),
    PRIMARY KEY(revision, subject_id)
);
CREATE TABLE quantum_v2.policy_parse_cache (
    locking_script_sha256 text NOT NULL CHECK(length(locking_script_sha256)=64),
    parser_version text NOT NULL,
    evidence_sha256 text NOT NULL CHECK(length(evidence_sha256)=64),
    parse_status text NOT NULL CHECK(parse_status IN ('recognized','unresolved')),
    threshold_m smallint, key_count_n smallint,
    public_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_height integer, source_reference text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(locking_script_sha256,parser_version,evidence_sha256),
    CHECK((parse_status='recognized' AND threshold_m>=1 AND key_count_n>=threshold_m)
       OR (parse_status='unresolved' AND threshold_m IS NULL AND key_count_n IS NULL))
);
