// Mocking required parts for a quick test
const predictiveAnalyticsService = require('../services/predictiveAnalyticsService');

// We need to bypass authenticate middleware for this test or mock it
// Actually, let's just check if the route can be mounted and responds
// But since it has authenticate, it will fail with 401.

async function testRoute() {
  try {
    console.log('Predictive Analytics Service: Loaded');
    
    // Test the service function directly
    const mockFilters = { scopeId: null, projectId: null };
    const data = await predictiveAnalyticsService.buildPredictiveInsights(mockFilters);
    console.log('Service Test Result:', JSON.stringify(data, null, 2));
    console.log('STATUS: SUCCESS');
  } catch (err) {
    console.error('STATUS: FAILED');
    console.error(err);
    process.exit(1);
  }
}

testRoute();
