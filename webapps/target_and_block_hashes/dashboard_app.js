window.WSBTargetHashesDashboard = window.WSBDailyHistoryDashboard({
  slug: "target_and_block_hashes", title: "Target & Block Hashes", chart: window.WSBTargetHashesChart,
  storageKey: "wsb_target_hashes_view_v1", timeline: "blocks", editableCount: true, blockSearch: true,
  expandedClass: "target-hashes-dashboard-expanded", expandedMessage: "wsb-target-hashes-dashboard-expanded",
  kpis: (s) => [["kpiDifficulty", s.difficulty], ["kpiHashrate", s.hashrate]],
  description: (s) => `Block ${s.height}; difficulty ${s.difficulty}; target hashrate ${s.hashrate}; lowest hash at block ${s.lowest}. Orange block hashes, white target, green record-low trail and blue halving diamonds.`,
});
