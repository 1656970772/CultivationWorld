use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

use crate::project::{dataset_file_name, dataset_keys};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Issue {
    pub severity: String,
    pub code: String,
    pub path: String,
    pub message: String,
    pub detail: Option<Value>,
}

pub fn validate_dataset_keys(datasets: &BTreeMap<String, Value>) -> Result<(), String> {
    for key in datasets.keys() {
        if dataset_file_name(key).is_none() {
            return Err(format!("unknown dataset key: {key}"));
        }
    }
    Ok(())
}

pub fn validate_all_datasets(datasets: &BTreeMap<String, Value>) -> Result<Vec<Issue>, String> {
    validate_dataset_keys(datasets)?;

    let mut issues = Vec::new();
    for key in dataset_keys() {
        if !datasets.contains_key(key) {
            issues.push(error(
                "missing_dataset",
                key,
                format!("missing required dataset: {key}"),
                None,
            ));
        }
    }

    for (key, value) in datasets {
        validate_dataset_shape_and_keys(key, value, &mut issues);
    }

    let faction_ids = collect_keys(dataset(datasets, "entities/factions", "factions"), "id");
    let npc_ids = collect_keys(dataset(datasets, "entities/npcs", "npcs"), "id");
    let mut terrain_ids = collect_keys(dataset(datasets, "definitions/terrains", "terrains"), "type");
    terrain_ids.extend(collect_keys(datasets.get("terrains"), "type"));
    let event_ids = collect_keys(datasets.get("events"), "type");

    validate_faction_leaders(
        dataset(datasets, "entities/factions", "factions"),
        &npc_ids,
        &mut issues,
    );
    validate_npc_factions(
        dataset(datasets, "entities/npcs", "npcs"),
        &faction_ids,
        &mut issues,
    );
    validate_rule_events(datasets.get("rules"), &event_ids, &mut issues);
    validate_map_references(
        dataset(datasets, "world/map", "map"),
        &terrain_ids,
        &faction_ids,
        &mut issues,
    );

    Ok(issues)
}

pub fn has_error(issues: &[Issue]) -> bool {
    issues.iter().any(|issue| issue.severity == "error")
}

fn validate_dataset_shape_and_keys(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    if key == "world/map" || key == "map" {
        validate_map_dataset(Some(value), issues);
        return;
    }

    if value.is_array() {
        validate_array_dataset(key, value, issues);
    } else if !value.is_object() {
        issues.push(error(
            "invalid_dataset_type",
            key,
            format!("{key} must be an array or object"),
            Some(json!({ "expected": "array_or_object" })),
        ));
    }
}

fn validate_array_dataset(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    let Some(items) = value.as_array() else {
        return;
    };

    let mut seen = BTreeSet::new();
    let primary_key = dataset_primary_key(key).unwrap_or("id");
    for (index, item) in items.iter().enumerate() {
        let path = format!("{key}[{index}].{primary_key}");
        let Some(id) = item.get(primary_key).and_then(Value::as_str) else {
            if item.get("id").is_none() && item.get("type").is_none() {
                issues.push(error(
                    "missing_primary_key",
                    path,
                    format!("{key}[{index}] is missing string {primary_key}"),
                    None,
                ));
            }
            continue;
        };
        if !seen.insert(id.to_string()) {
            issues.push(error(
                "duplicate_primary_key",
                path,
                format!("duplicate id in {key}: {id}"),
                Some(json!({ "id": id })),
            ));
        }
    }
}

fn validate_map_dataset(value: Option<&Value>, issues: &mut Vec<Issue>) {
    let Some(value) = value else {
        return;
    };
    let Some(map) = value.as_object() else {
        issues.push(error(
            "invalid_dataset_type",
            "world/map",
            "map must be an object".to_string(),
            Some(json!({ "expected": "object" })),
        ));
        return;
    };

    for field in ["width", "height"] {
        if map.get(field).and_then(Value::as_i64).is_none() {
            issues.push(error(
                "invalid_map_shape",
                format!("world/map.{field}"),
                format!("map.{field} must be an integer"),
                None,
            ));
        }
    }

    let Some(tiles) = map.get("tiles") else {
        issues.push(error(
            "invalid_map_shape",
            "world/map.tiles",
            "map.tiles must be an array".to_string(),
            None,
        ));
        return;
    };
    if !tiles.is_array() {
        issues.push(error(
            "invalid_map_shape",
            "world/map.tiles",
            "map.tiles must be an array".to_string(),
            Some(json!({ "expected": "array" })),
        ));
    }
}

fn validate_faction_leaders(
    factions: Option<&Value>,
    npc_ids: &BTreeSet<String>,
    issues: &mut Vec<Issue>,
) {
    let Some(factions) = factions.and_then(Value::as_array) else {
        return;
    };

    for (index, faction) in factions.iter().enumerate() {
        let Some(leader_id) = faction.get("leader").and_then(Value::as_str) else {
            continue;
        };
        if !leader_id.is_empty() && !npc_ids.contains(leader_id) {
            issues.push(invalid_reference(
                format!("entities/factions[{index}].leader"),
                leader_id,
                "NPC",
            ));
        }
    }
}

fn validate_npc_factions(
    npcs: Option<&Value>,
    faction_ids: &BTreeSet<String>,
    issues: &mut Vec<Issue>,
) {
    let Some(npcs) = npcs.and_then(Value::as_array) else {
        return;
    };

    for (index, npc) in npcs.iter().enumerate() {
        let Some(faction_id) = npc.get("factionId").and_then(Value::as_str) else {
            continue;
        };
        if !faction_id.is_empty() && !faction_ids.contains(faction_id) {
            issues.push(invalid_reference(
                format!("entities/npcs[{index}].factionId"),
                faction_id,
                "faction",
            ));
        }
    }
}

fn validate_rule_events(
    rules: Option<&Value>,
    event_ids: &BTreeSet<String>,
    issues: &mut Vec<Issue>,
) {
    let Some(rules) = rules.and_then(Value::as_array) else {
        return;
    };

    for (index, rule) in rules.iter().enumerate() {
        let Some(event_type) = rule.get("event_type").and_then(Value::as_str) else {
            continue;
        };
        if !event_ids.contains(event_type) {
            issues.push(invalid_reference(
                format!("rules[{index}].event_type"),
                event_type,
                "event",
            ));
        }
    }
}

fn validate_map_references(
    map: Option<&Value>,
    terrain_ids: &BTreeSet<String>,
    faction_ids: &BTreeSet<String>,
    issues: &mut Vec<Issue>,
) {
    let Some(map) = map.and_then(Value::as_object) else {
        return;
    };
    let width = map.get("width").and_then(Value::as_i64);
    let height = map.get("height").and_then(Value::as_i64);
    let Some(tiles) = map.get("tiles").and_then(Value::as_array) else {
        return;
    };
    let mut coordinates = BTreeSet::new();

    for (index, tile) in tiles.iter().enumerate() {
        let path = format!("world/map.tiles[{index}]");
        let x = tile.get("x").and_then(Value::as_i64);
        let y = tile.get("y").and_then(Value::as_i64);

        match (x, y) {
            (Some(x), Some(y)) => {
                if !coordinates.insert((x, y)) {
                    issues.push(error(
                        "duplicate_map_coordinate",
                        path.clone(),
                        format!("duplicate map tile coordinate: ({x}, {y})"),
                        Some(json!({ "x": x, "y": y })),
                    ));
                }
                if let (Some(width), Some(height)) = (width, height) {
                    if x < 0 || y < 0 || x >= width || y >= height {
                        issues.push(error(
                            "map_coordinate_out_of_bounds",
                            path.clone(),
                            format!("map tile coordinate is outside bounds: ({x}, {y})"),
                            Some(json!({
                                "x": x,
                                "y": y,
                                "width": width,
                                "height": height
                            })),
                        ));
                    }
                }
            }
            _ => issues.push(error(
                "invalid_map_tile",
                path.clone(),
                "map tile must contain integer x and y".to_string(),
                None,
            )),
        }

        if let Some(terrain_id) = tile.get("terrain").and_then(Value::as_str) {
            if !terrain_ids.contains(terrain_id) {
                issues.push(invalid_reference(
                    format!("{path}.terrain"),
                    terrain_id,
                    "terrain",
                ));
            }
        }

        if let Some(owner_id) = tile.get("ownerId").and_then(Value::as_str) {
            if !faction_ids.contains(owner_id) {
                issues.push(invalid_reference(
                    format!("{path}.ownerId"),
                    owner_id,
                    "faction",
                ));
            }
        }
    }
}

fn collect_ids(value: Option<&Value>) -> BTreeSet<String> {
    collect_keys(value, "id")
}

fn collect_keys(value: Option<&Value>, key_field: &str) -> BTreeSet<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get(key_field).and_then(Value::as_str))
        .map(ToString::to_string)
        .collect()
}

fn dataset<'a>(
    datasets: &'a BTreeMap<String, Value>,
    key: &str,
    legacy_key: &str,
) -> Option<&'a Value> {
    datasets.get(key).or_else(|| datasets.get(legacy_key))
}

fn dataset_primary_key(key: &str) -> Option<&'static str> {
    match key {
        "factions" | "npcs" | "rules" | "entities/factions" | "entities/npcs" => Some("id"),
        "terrains" | "modifiers" | "events" => Some("type"),
        "definitions/terrains" => Some("type"),
        "world/modifiers" | "actions/world-rules" => Some("id"),
        _ => None,
    }
}

fn invalid_reference(path: String, value: &str, target: &str) -> Issue {
    error(
        "invalid_reference",
        path,
        format!("{value} does not reference an existing {target}"),
        Some(json!({ "value": value, "target": target })),
    )
}

fn error(
    code: impl Into<String>,
    path: impl Into<String>,
    message: String,
    detail: Option<Value>,
) -> Issue {
    Issue {
        severity: "error".to_string(),
        code: code.into(),
        path: path.into(),
        message,
        detail,
    }
}
