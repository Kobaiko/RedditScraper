const path = require('path');
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const query = event.path.split('/').pop();
    if (!query) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No search query provided' })
      };
    }

    // Get Reddit access token
    const authResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    const authData = await authResponse.json();
    if (!authData.access_token) {
      throw new Error('Failed to get Reddit access token');
    }

    // Search Reddit
    const searchResponse = await fetch(
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${authData.access_token}`,
          'User-Agent': 'SentimentAnalyzer/1.0'
        }
      }
    );

    const searchData = await searchResponse.json();
    const posts = searchData.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      score: child.data.score,
      num_comments: child.data.num_comments,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit,
      url: child.data.url,
      selftext: child.data.selftext || '',
      sentiment: analyzeSentiment(child.data.title + ' ' + (child.data.selftext || ''), child.data.score, child.data.num_comments, child.data.created_utc)
    }));

    // Calculate sentiment stats
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    const subredditSentiment = {};

    posts.forEach(post => {
      sentimentCounts[post.sentiment]++;
      
      if (!subredditSentiment[post.subreddit]) {
        subredditSentiment[post.subreddit] = { positive: 0, negative: 0, neutral: 0 };
      }
      subredditSentiment[post.subreddit][post.sentiment]++;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        posts,
        overall_sentiment: sentimentCounts,
        subreddit_sentiment: subredditSentiment,
        total_posts: posts.length
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Sentiment analysis with Reddit-specific adjustments
function analyzeSentiment(text, score = 0, numComments = 0, created = '') {
  // Clean and normalize text
  text = text.toLowerCase()
    .replace(/https?:\/\/\S+/g, '')  // Remove URLs
    .replace(/[^\w\s]/g, ' ')        // Remove special characters
    .trim();
  
  const words = text.split(/\s+/);
  
  // Base sentiment calculation
  let baseSentiment = 0;
  
  // Word-based scoring with Reddit-specific terms
  const sentimentWords = {
    positive: {
      // General positive
      'good': 0.3, 'great': 0.4, 'awesome': 0.5, 'excellent': 0.5, 'amazing': 0.5,
      'love': 0.4, 'perfect': 0.5, 'best': 0.4, 'nice': 0.3, 'thanks': 0.3,
      // Reddit-specific positive
      'upvote': 0.3, 'helpful': 0.4, 'interesting': 0.3, 'til': 0.2, 'op': 0.1,
      'wholesome': 0.5, 'underrated': 0.3, 'quality': 0.3,
      // Tech/gaming positive
      'works': 0.3, 'fixed': 0.4, 'solved': 0.4, 'improved': 0.3
    },
    negative: {
      // General negative
      'bad': -0.3, 'terrible': -0.5, 'awful': -0.5, 'horrible': -0.5, 'worst': -0.5,
      'hate': -0.4, 'poor': -0.3, 'garbage': -0.4, 'waste': -0.4,
      // Reddit-specific negative
      'repost': -0.3, 'downvote': -0.3, 'toxic': -0.4, 'cringe': -0.3,
      'clickbait': -0.4, 'spam': -0.4,
      // Tech/gaming negative
      'bug': -0.3, 'broken': -0.4, 'crash': -0.4, 'issue': -0.3, 'problem': -0.3
    }
  };

  // Calculate base sentiment from words
  words.forEach(word => {
    baseSentiment += sentimentWords.positive[word] || 0;
    baseSentiment += sentimentWords.negative[word] || 0;
  });

  // Normalize base sentiment to [-1, 1]
  baseSentiment = Math.max(-1, Math.min(1, baseSentiment));

  // Context adjustments
  const karmaFactor = score ? Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.1 : 0;
  const commentFactor = numComments ? Math.log(numComments + 1) * 0.1 : 0;
  
  // Time decay (newer posts get slightly higher weight)
  const ageInDays = created ? (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24) : 0;
  const timeDecay = 1 / (1 + ageInDays * 0.1);

  // Length factor (longer posts need stronger sentiment to be classified)
  const lengthFactor = 1 + Math.min(words.length / 100, 0.5);

  // Combine all factors
  let finalScore = (baseSentiment + karmaFactor + commentFactor) * timeDecay * lengthFactor;
  
  // Clamp final score to [-1, 1]
  finalScore = Math.max(-1, Math.min(1, finalScore));

  // Classify sentiment with wider neutral range
  if (finalScore > 0.3) return 'positive';
  if (finalScore < -0.3) return 'negative';
  return 'neutral';
}
