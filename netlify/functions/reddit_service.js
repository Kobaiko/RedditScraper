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
      'good': 0.6, 'great': 0.8, 'awesome': 1.0, 'excellent': 1.0, 'amazing': 1.0,
      'love': 0.8, 'perfect': 1.0, 'best': 0.8, 'nice': 0.6, 'thanks': 0.6,
      // Reddit-specific positive
      'upvote': 0.6, 'helpful': 0.8, 'interesting': 0.6, 'til': 0.4, 'op': 0.2,
      'wholesome': 1.0, 'underrated': 0.6, 'quality': 0.6,
      // Tech/gaming positive
      'works': 0.6, 'fixed': 0.8, 'solved': 0.8, 'improved': 0.6
    },
    negative: {
      // General negative
      'bad': -0.6, 'terrible': -1.0, 'awful': -1.0, 'horrible': -1.0, 'worst': -1.0,
      'hate': -0.8, 'poor': -0.6, 'garbage': -0.8, 'waste': -0.8,
      // Reddit-specific negative
      'repost': -0.6, 'downvote': -0.6, 'toxic': -0.8, 'cringe': -0.6,
      'clickbait': -0.8, 'spam': -0.8,
      // Tech/gaming negative
      'bug': -0.6, 'broken': -0.8, 'crash': -0.8, 'issue': -0.6, 'problem': -0.6
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
  const karmaFactor = score ? Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.2 : 0;
  const commentFactor = numComments ? Math.log(numComments + 1) * 0.2 : 0;
  
  // Time decay (newer posts get slightly higher weight)
  const ageInDays = created ? (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24) : 0;
  const timeDecay = 1 / (1 + ageInDays * 0.1);

  // Length factor (longer posts need stronger sentiment to be classified)
  const lengthFactor = 1 + Math.min(words.length / 100, 0.5);

  // Combine all factors
  let finalScore = (baseSentiment + karmaFactor + commentFactor) * timeDecay * lengthFactor;
  
  // Clamp final score to [-1, 1]
  finalScore = Math.max(-1, Math.min(1, finalScore));

  // Classify sentiment with narrower neutral range
  if (finalScore > 0.15) return 'positive';
  if (finalScore < -0.15) return 'negative';
  return 'neutral';
}
