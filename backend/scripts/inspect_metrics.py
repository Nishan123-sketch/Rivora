import json

with open("backend/reports/advanced-level-network.json", "r", encoding="utf-8") as f:
    net = json.load(f)

print("training_metrics:", json.dumps(net.get("training_metrics"), indent=2))
print("pipeline_status:", json.dumps(net.get("pipeline_status"), indent=2))

# Also check how many total horizons are accepted across all stations
accepted_horizons = 0
total_horizons = 0
for s in net.get("stations", []):
    for h in s.get("horizons", []):
        total_horizons += 1
        if h.get("advanced_accepted"):
            accepted_horizons += 1
print(f"Total station-horizons: {total_horizons}, Accepted advanced horizons: {accepted_horizons}")
