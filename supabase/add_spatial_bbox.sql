-- =============================================================
-- CHARGEMENT SPATIAL PAR EMPRISE (BBOX) — index GiST PostGIS
--
-- Objectif : sur un recensement de 50 000+ points répartis sur toute la
-- Côte d'Ivoire, un agent qui travaille dans une seule ville n'a besoin que
-- des ~quelques centaines de points visibles à l'écran. Ce script ajoute
-- une colonne géographique dérivée + un index GiST + un RPC qui ne renvoie
-- que les points dans l'emprise (bounding box) de la carte.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). N'altère aucune donnée.
-- Côté application : opt-in via VITE_ENABLE_BBOX_LOADING=true (voir
-- src/modules/census/dataLoader.js: refreshPointsInBounds). Tant que le flag
-- est à false, ce script est inerte pour le client.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Colonne géographique dérivée (générée, stockée) : reste toujours
-- cohérente avec lat/lon sans trigger applicatif. NULL si le point n'a pas
-- encore de coordonnées (création offline avant capture GPS).
ALTER TABLE census_points
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN lon IS NOT NULL AND lat IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
    END
  ) STORED;

-- Index spatial : c'est lui qui rend la requête d'emprise sous-linéaire.
CREATE INDEX IF NOT EXISTS idx_census_points_geog ON census_points USING GIST (geog);

-- RPC d'emprise. LANGUAGE sql + STABLE + SECURITY INVOKER (défaut) : les
-- policies RLS de census_points (is_approved_user(), etc.) s'appliquent
-- normalement — un compte non validé ne récupère rien ici non plus.
-- max_rows borné [1, 10000] pour éviter qu'un dézoom extrême ne rapatrie
-- tout le pays.
CREATE OR REPLACE FUNCTION census_points_in_bbox(
  min_lon DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lon DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  max_rows INTEGER DEFAULT 2000
)
RETURNS SETOF census_points
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM census_points
  WHERE geog && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
  ORDER BY block, "order"
  LIMIT GREATEST(1, LEAST(COALESCE(max_rows, 2000), 10000));
$$;

REVOKE ALL ON FUNCTION census_points_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION census_points_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
