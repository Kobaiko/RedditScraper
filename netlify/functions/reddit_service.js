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

function analyzeSentiment(text, score = 0, numComments = 0, created = '') {
  // Clean and normalize text
  text = text.toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  const words = text.split(/\s+/);
  
  // Sentiment dictionaries with weighted scores
  const sentimentDict = {
    // Strong negative terms (-2)
    'war': -2, 'death': -2, 'killed': -2, 'dead': -2, 'murder': -2,
    'terrorist': -2, 'terrorism': -2, 'attack': -2, 'violence': -2,
    'genocide': -2, 'massacre': -2, 'catastrophe': -2, 'disaster': -2,
    'crisis': -2, 'tragic': -2, 'horrific': -2, 'devastating': -2,
    
    // Moderate negative terms (-1)
    'conflict': -1, 'fight': -1, 'problem': -1, 'issue': -1, 'tension': -1,
    'protest': -1, 'dispute': -1, 'controversial': -1, 'criticism': -1,
    'concern': -1, 'worried': -1, 'fear': -1, 'threat': -1, 'risk': -1,
    'angry': -1, 'sad': -1, 'bad': -1, 'wrong': -1, 'hate': -1,
    
    // Moderate positive terms (1)
    'peace': 1, 'agreement': 1, 'support': 1, 'help': 1, 'improve': 1,
    'progress': 1, 'solution': 1, 'hope': 1, 'good': 1, 'better': 1,
    'cooperation': 1, 'positive': 1, 'success': 1, 'achieve': 1,
    
    // Strong positive terms (2)
    'victory': 2, 'triumph': 2, 'excellence': 2, 'breakthrough': 2,
    'celebration': 2, 'achievement': 2, 'peace': 2, 'reconciliation': 2
  };

  // Calculate base sentiment
  let sentimentScore = 0;
  let wordCount = 0;

  words.forEach(word => {
    if (sentimentDict[word] !== undefined) {
      sentimentScore += sentimentDict[word];
      wordCount++;
    }
  });

  // If we found sentiment words, normalize by word count
  if (wordCount > 0) {
    sentimentScore = sentimentScore / Math.sqrt(wordCount);
  }

  // Add karma influence (reduced weight)
  if (score) {
    const karmaInfluence = Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.2;
    sentimentScore += karmaInfluence;
  }

  // Add comment count influence (reduced weight)
  if (numComments) {
    const commentInfluence = Math.log(numComments + 1) * 0.1;
    sentimentScore += commentInfluence;
  }

  // Time decay factor (newer posts have slightly more weight)
  if (created) {
    const ageInDays = (Date.now() - new Date(created * 1000).getTime()) / (1000 * 60 * 60 * 24);
    const timeDecay = 1 / (1 + ageInDays * 0.05);
    sentimentScore *= timeDecay;
  }

  // Normalize final score to a reasonable range
  sentimentScore = Math.max(-2, Math.min(2, sentimentScore));

  // Classify with balanced thresholds
  if (sentimentScore > 0.3) return 'positive';
  if (sentimentScore < -0.3) return 'negative';
  return 'neutral';
}
