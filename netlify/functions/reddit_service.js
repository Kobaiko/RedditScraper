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
    // Return mock data matching the expected structure
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        posts: [],
        overall_sentiment: {
          positive: 0,
          negative: 0,
          neutral: 0
        },
        subreddit_sentiment: {},
        total_posts: 0
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
