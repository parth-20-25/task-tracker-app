SELECT p.id AS project_id
FROM design.projects p
LEFT JOIN design.fixtures f
  ON f.project_id = p.id
WHERE f.id IS NULL;
