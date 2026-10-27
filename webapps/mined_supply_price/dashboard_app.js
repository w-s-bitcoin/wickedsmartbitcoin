window.WSBMinedSupplyPriceDashboard = window.WSBDailyHistoryDashboard({
  slug: "mined_supply_price", title: "Mined Supply & Price", chart: window.WSBMinedSupplyPriceChart,
  storageKey: "wsb_mined_supply_price_view_v1",
  expandedClass: "mined-supply-dashboard-expanded", expandedMessage: "wsb-mined-supply-dashboard-expanded",
  kpis: (s) => [["kpiEpoch", s.epoch], ["kpiSubsidy", `${s.subsidy} BTC`], ["kpiSupply", `${s.supply} BTC`], ["kpiPrice", s.price]],
  description: (s) => `${s.percent.toFixed(1)}% of Bitcoin mined at block ${s.height}; Bitcoin price ${s.price}; epoch ${s.epoch}.`,
});
