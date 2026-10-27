window.WSBPriceDistributionDashboard = window.WSBDailyHistoryDashboard({
  slug: "price_distribution", title: "Price Distribution", chart: window.WSBPriceDistributionChart,
  storageKey: "wsb_price_distribution_view_v1",
  expandedClass: "price-distribution-dashboard-expanded", expandedMessage: "wsb-price-distribution-dashboard-expanded",
  kpis: (s) => [["kpiAge", s.age], ["kpiPrice", s.price]],
  description: (s) => `Bitcoin price ${s.price} at block ${s.height}; network age ${s.age}. Daily observations grouped by price range, including Not Valued.`,
});
