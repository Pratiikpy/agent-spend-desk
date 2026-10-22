# Profile: opencost/opencost

Reader: agy (Gemini), 2026-10-20, for . Remote inspection via `gh api` and raw file streaming without cloning. Licence read first: Apache 2.0 (`LICENSE:1-201`). Repository metadata: 6,785 stars on 2026-10-20; last commit `788010c8d9a37714972c565394228cce71c01c4b` dated 2026-10-19T16:19:32Z (`pushed_at: 2026-10-19T16:43:35Z`).

## 1. What it is
OpenCost is an open-source cost allocation and monitoring engine for Kubernetes and cloud spend, originally created by Kubecost. Apache 2.0 (`LICENSE:1-201`), last commit read 2026-10-19 (`788010c`), reader: agy (Gemini), 2026-10-20.

## 2. Architecture map
- **CLI & Core Entry**: `cmd/costmodel/main.go:8-13` executes root command `pkg/cmd/costmodel/costmodel.go`.
- **HTTP Routing & API**: `pkg/costmodel/router.go:586-635` registers `/allocation/compute`, `/allocation/compute/summary`, `/cloudCost`, `/allNodePricing`.
- **Allocation Pipeline**: `pkg/costmodel/costmodel.go:1650-1765` (`QueryAllocation`), `pkg/costmodel/allocation.go:219-240` (`computeAllocation`), and `pkg/costmodel/aggregation.go:331-411` (`ComputeAllocationHandler`).
- **Core Entities & Mathematics**: `core/pkg/opencost/allocation.go:55-112` (`Allocation` struct), `AllocationSet` (`:1560-1610`), `core/pkg/opencost/allocationprops.go:361-452` (`Properties.GenerateKey`).
- **Data Ingestion**: Prometheus metrics queries (`pkg/costmodel/allocation_helpers.go:170-281`, `:468-523`), Cloud Provider billing APIs (`pkg/cloud/`), and custom CSV pricing (`configs/pricing_schema.csv`).
- **AI Inference Tracking & MCP**: `pkg/inferencecost/calculator.go:22-164` (vLLM token attribution), `pkg/mcp/server.go:30-87` (MCP server exposing allocation, asset, cloudcost, efficiency).

## 3. Features and how each behaves
- **Allocation Query (`/allocation/compute`)**: Computes windowed cost allocations parameterized by `window`, `aggregate`, `step`, `accumulateBy`, `includeIdle`, `idleByNode`, `shareIdle`, and `filter` (`pkg/costmodel/aggregation.go:332-390`).
- **Default Aggregation**: If unassigned, defaults to `Cluster/Node/Namespace/Pod/Container` (`pkg/costmodel/aggregation.go:36-42`); `aggregate=all` collapses entire fleets (`:43-44`).
- **Missing Property Handling**: Missing labels or properties default to `__unallocated__` (`core/pkg/opencost/allocation.go:34`, `core/pkg/opencost/allocationprops.go:438,451`).
- **Failure Behaviour**: HTTP 400 on malformed windows or unparsable aggregations (`pkg/costmodel/aggregation.go:401-404`). Negative idle costs are clamped to zero (`pkg/costmodel/costmodel.go:2156-2170`). Unpriced nodes log warnings and evaluate to zero (`pkg/costmodel/allocation_helpers.go:1951-1960`).

## 4. How people use it
Installed on Kubernetes 1.20+ via Helm (`helm install opencost opencost/opencost`, `README.md:38-42`); standalone YAML manifests have been deprecated (`README.md:44`). Prompts Prometheus via `/metrics` scrape (`README.md:25`). The web UI runs externally in `opencost/opencost-ui` (`README.md:13`). Production usage stats from community issues: NOT VERIFIED.

## 5. Mechanism for the Desk
- **Base Allocation Formula**:
  Allocated resources equal `max(usage, request)`:
  - `alloc.CPUCoreHours = max(usage, request) * hours` (`pkg/costmodel/allocation_helpers.go:206-212, 263-267`).
  - `alloc.RAMByteHours = max(usage, request) * hours` (`pkg/costmodel/allocation_helpers.go:468, 519-522`).
  - `alloc.CPUCost = alloc.CPUCoreHours * node.CostPerCPUHr` (`pkg/costmodel/allocation_helpers.go:1927`).
  - `alloc.RAMCost = (alloc.RAMByteHours / 1024^3) * node.CostPerRAMGiBHr` (`pkg/costmodel/allocation_helpers.go:1928`).
  - `alloc.GPUCost = alloc.GPUHours * node.CostPerGPUHr` (`pkg/costmodel/allocation_helpers.go:1929`).
- **Idle Waste Accounting**:
  Idle cost represents provisioned capacity unabsorbed by workloads:
  - `cpuIdleCost = assetTotal.TotalCPUCost() - allocTotal.TotalCPUCost()` (`pkg/costmodel/costmodel.go:2151`).
  - `gpuIdleCost = assetTotal.TotalGPUCost() - allocTotal.TotalGPUCost()` (`pkg/costmodel/costmodel.go:2152`).
  - `ramIdleCost = assetTotal.TotalRAMCost() - allocTotal.TotalRAMCost()` (`pkg/costmodel/costmodel.go:2153`).
  - Clamped to 0 if negative (`pkg/costmodel/costmodel.go:2156-2170`).
  - Named `<entity>/__idle__` (`core/pkg/opencost/allocation.go:28`, `pkg/costmodel/costmodel.go:2149`).
- **Idle Distribution Pipeline** (11-step sequence in `core/pkg/opencost/allocation.go:1564-1609`):
  - In `ShareWeighted` mode, idle coefficients are computed per-node or per-cluster, per-resource:
    `coeffs[idleId][name][resource] = alloc.<Resource>TotalCost() / totals[idleId][resource]` (`core/pkg/opencost/allocation.go:2342-2348, 2393`).
  - Distributed into workloads: `alloc.<Resource>Cost += idleAlloc.<Resource>Cost * idleCoefficients[idleId][alloc.Name][resource]` (`:1928-1937`).
  - Step 10 retains undistributed idle (e.g. GPU idle when workloads only use CPU/RAM) in `__idle__` rather than discarding it (`:2105-2124`).
- **Shared Overhead Distribution**:
  - `ShareEven`: equal distribution `coeffs[name] = 1.0`, `total = len(coeffs)` (`core/pkg/opencost/allocation.go:2278-2282`).
  - `ShareWeighted`: proportional to net workload cost `alloc.TotalCost() - alloc.SharedCost - alloc.UnmountedPVCost` (`:2286-2287`).
  - **Invariant Conservation via `__filtered__`**: When filters are applied, the share of excluded workloads is dumped into `__filtered__` and discarded (`:2268-2276`). This preserves shared cost invariance so filtering does not inflate remaining items.
  - Per-item breakdowns tracked in `SharedCostBreakdown` (`:2072-2085`).
- **Allocation by Label & Taxonomy**:
  - `Properties.GenerateKey(aggregateBy, labelConfig)` extracts `label:<name>` and `annotation:<name>` (`core/pkg/opencost/allocationprops.go:361-452`).
  - Built-in business mapping properties: `DepartmentLabel`, `EnvironmentLabel`, `OwnerLabel`, `ProductLabel` (`:453-510`).
- **Efficiency Formula**:
  - `CPUEfficiency = CPUCoreUsageAverage / CPUCoreRequestAverage` (`core/pkg/opencost/allocation.go:1037`).
  - `TotalEfficiency = (RAMEfficiency * RAMTotalCost + CPUEfficiency * CPUTotalCost) / (CPUTotalCost + RAMTotalCost)` (`:1100-1102`).
- **What they lose / get wrong**:
  Granularity stops at the container level. OpenCost sees CPU/RAM metrics but is blind to runaway agent loops, futile retry cascades, and hallucinated work. Clamping negative idle to zero (`pkg/costmodel/costmodel.go:2156-2170`) masks billing and metric collection discrepancies.
- **What the Desk does better**:
  Map the mathematical allocation model from Kubernetes pods to AI agent operations:
  - Aggregate by agent session, workflow label, customer tenant, and model tier (`label:agent_id`, `label:task_type`).
  - Define idle waste as reserved model concurrency, idle pool timeouts, and unutilized token quotas.
  - Couple cost allocation directly to verified deliverable value (receipts of landed work).

## 6. Agent patterns
OpenCost acts as an infrastructure telemetry server rather than an autonomous multi-agent coordinator. However, it ships an MCP interface (`pkg/mcp/server.go:44-87`) allowing external AI agents to query cost allocations, efficiency, and idle spend. Its vLLM inference module (`pkg/inferencecost/calculator.go:22-164`) models token cost splits using compute time or token multipliers adjusted by KV cache hit rates (`min(CachedTokens/PromptTokens, 1.0)`).

## 7. Model and data layer
Pluggable data source interface `source.OpenCostDataSource` (`core/pkg/source/datasource.go:11-20`). Ingests Prometheus metrics via PromQL, queries Kubernetes API for pod metadata, and reconciles against cloud billing APIs (AWS, Azure, GCP) or local pricing matrices (`configs/pricing_schema.csv`).

## 8. Hackathon-care checks
- Offline / Local mode: Operates completely offline with synthetic pricing CSVs and mock sources (`configs/pricing_schema.csv:1-10`).
- Docker & Orchestration: Helm charts (`README.md:39-42`) and local Tilt setups (`Tiltfile.opencost:1-20`).
- Regression suite: Deep Go unit tests covering allocation aggregation, idle allocation, and provider ID mapping (`core/pkg/opencost/allocation_test.go:1-150`, `pkg/costmodel/aggregation_test.go:1-200`).
- Security: HTTP Basic/Admin auth middleware guards mutation endpoints (`pkg/costmodel/router.go:139, 631-632`).

## 9. Traps seen
- Negative idle clamp: Clamping `cpuIdleCost = 0` when `assetTotal < allocTotal` (`pkg/costmodel/costmodel.go:2156-2170`) silently conceals underlying metric ingestion and pricing errors.
- Single service selection: Iteration over `p.Services` breaks immediately after the first service, dropping multi-service mappings (`core/pkg/opencost/allocationprops.go:423-426`).
- Arbitrary buffer constants: Hardcoded 20% stability headroom in MCP efficiency (`pkg/mcp/server.go:39`).

## 10. Reuse
Apache 2.0 (`LICENSE:1-201`): Algorithms and formulas may be adopted with notice and credit. Candidate mechanisms: (1) The 11-step idle and shared allocation pipeline; (2) The `__filtered__` conservation technique during shared cost attribution; (3) Dynamic label key generation with `__unallocated__` fallbacks.

## 11. Verdict: ADAPT the mathematical cost allocation and idle waste engine for Agent Spend Desk
- **Copy**:
  1. The 11-step idle distribution algorithm with resource-weighted coefficients (`ShareWeighted`) and undistributed idle retention (`core/pkg/opencost/allocation.go:1564-1609, 2105-2124`).
  2. The `__filtered__` bin conservation logic that prevents shared overhead costs from inflating when users apply sub-filters (`core/pkg/opencost/allocation.go:2268-2276`).
  3. Dynamic label key generation (`Properties.GenerateKey`) with automatic sanitization and `__unallocated__` bucket mapping (`core/pkg/opencost/allocationprops.go:361-452`).
- **Avoid**:
  1. Clamping negative idle costs to zero without throwing calibration alerts (`pkg/costmodel/costmodel.go:2156-2170`).
  2. Dropping multiple service labels in favor of arbitrary first-element picking (`core/pkg/opencost/allocationprops.go:423-426`).
  3. Stopping cost allocation at raw hardware runtime without verifying task completion quality.
