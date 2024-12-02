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
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  const words = text.split(/\s+/);
  let baseSentiment = 0;

  // Common phrases check (do this first)
  const phrases = {
    positive: [
      'works well', 'really good', 'very good', 'pretty good', 'works great',
      'much better', 'really like', 'really love', 'very happy', 'great app',
      'good app', 'works perfectly', 'highly recommend', 'love it', 'great experience'
    ],
    negative: [
      'doesnt work', 'does not work', 'stopped working', 'not working',
      'waste of', 'too expensive', 'very bad', 'terrible app', 'horrible app',
      'useless app', 'really bad', 'pretty bad', 'absolute garbage',
      'keeps crashing', 'constantly crashes'
    ]
  };

  // Check for phrases first (they have higher weight)
  phrases.positive.forEach(phrase => {
    if (text.includes(phrase)) baseSentiment += 1.5;
  });

  phrases.negative.forEach(phrase => {
    if (text.includes(phrase)) baseSentiment -= 1.5;
  });
  
  // Word-based scoring
  const sentimentWords = {
    positive: {
      // General positive
      'good': 0.8, 'great': 1.0, 'awesome': 1.2, 'excellent': 1.2, 'amazing': 1.2,
      'love': 1.0, 'perfect': 1.2, 'best': 1.0, 'nice': 0.8, 'thanks': 0.6,
      'better': 0.8, 'helpful': 1.0, 'fantastic': 1.2, 'wonderful': 1.2,
      'happy': 0.8, 'pleased': 0.8, 'impressive': 1.0, 'recommend': 1.0,
      // App-specific positive
      'works': 0.8, 'working': 0.8, 'worked': 0.8, 'fast': 0.8, 'smooth': 1.0,
      'reliable': 1.0, 'stable': 0.8, 'accurate': 1.0, 'easy': 0.8, 'useful': 1.0,
      'worth': 0.8, 'convenient': 1.0, 'improved': 0.8, 'improvement': 0.8
    },
    negative: {
      // General negative
      'bad': -0.8, 'terrible': -1.2, 'awful': -1.2, 'horrible': -1.2, 'worst': -1.2,
      'hate': -1.0, 'poor': -0.8, 'garbage': -1.0, 'waste': -1.0, 'useless': -1.0,
      'disappointing': -0.8, 'disappointed': -0.8, 'frustrating': -1.0,
      'annoying': -0.8, 'avoid': -1.0, 'regret': -1.0,
      // App-specific negative
      'bug': -0.8, 'bugs': -0.8, 'broken': -1.0, 'crash': -1.0, 'crashes': -1.0,
      'slow': -0.8, 'unusable': -1.2, 'error': -0.8, 'errors': -0.8,
      'expensive': -0.8, 'ads': -0.6, 'laggy': -0.8, 'stuck': -0.8,
      'freezes': -0.8, 'freeze': -0.8, 'glitch': -0.8, 'glitches': -0.8
    }
  };

  // Calculate word-based sentiment
  words.forEach(word => {
    baseSentiment += sentimentWords.positive[word] || 0;
    baseSentiment += sentimentWords.negative[word] || 0;
  });

  // Context adjustments with higher weights
  const karmaFactor = score ? Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.3 : 0;
  const commentFactor = numComments ? Math.log(numComments + 1) * 0.3 : 0;
  
  // Time decay (newer posts get higher weight)
  const ageInDays = created ? (Date.now() - new Date(created * 1000).getTime()) / (1000 * 60 * 60 * 24) : 0;
  const timeDecay = 1 / (1 + ageInDays * 0.1);

  // Length factor
  const lengthFactor = 1 + Math.min(words.length / 50, 0.5);

  // Combine all factors
  let finalScore = (baseSentiment + karmaFactor + commentFactor) * timeDecay * lengthFactor;
  
  // Clamp final score to [-1, 1]
  finalScore = Math.max(-1, Math.min(1, finalScore));

  // Very narrow neutral range
  if (finalScore > 0.05) return 'positive';
  if (finalScore < -0.05) return 'negative';
  return 'neutral';
}
