const path = require('path');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Simple test response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Function is working',
        path: event.path,
        query: event.path.split('/').pop(),
        env: {
          clientId: process.env.REDDIT_CLIENT_ID ? 'Present' : 'Missing',
          clientSecret: process.env.REDDIT_CLIENT_SECRET ? 'Present' : 'Missing'
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
};
