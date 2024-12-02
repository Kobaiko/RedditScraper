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
  
  // Universal sentiment dictionary with weighted scores
  const sentimentDict = {
    // Universal strong negative terms (-2)
    'terrible': -2, 'horrible': -2, 'awful': -2, 'disaster': -2, 'catastrophe': -2,
    'hate': -2, 'disgusting': -2, 'outrage': -2, 'horrific': -2, 'devastating': -2,
    'killed': -2, 'dead': -2, 'murder': -2, 'worst': -2, 'evil': -2, 'tragic': -2,
    'failure': -2, 'crisis': -2, 'corrupt': -2, 'violence': -2, 'attack': -2,
    
    // Universal moderate negative terms (-1)
    'bad': -1, 'poor': -1, 'wrong': -1, 'angry': -1, 'sad': -1, 'upset': -1,
    'broken': -1, 'fail': -1, 'failed': -1, 'useless': -1, 'waste': -1,
    'problem': -1, 'issue': -1, 'difficult': -1, 'expensive': -1, 'worried': -1,
    'annoying': -1, 'disappointed': -1, 'frustrating': -1, 'complaint': -1,
    'controversy': -1, 'negative': -1, 'against': -1, 'criticism': -1,
    
    // Universal moderate positive terms (1)
    'good': 1, 'nice': 1, 'better': 1, 'improved': 1, 'helpful': 1,
    'positive': 1, 'success': 1, 'happy': 1, 'glad': 1, 'well': 1,
    'support': 1, 'interesting': 1, 'fun': 1, 'agree': 1, 'like': 1,
    'useful': 1, 'recommend': 1, 'progress': 1, 'solution': 1,
    
    // Universal strong positive terms (2)
    'amazing': 2, 'excellent': 2, 'awesome': 2, 'fantastic': 2, 'perfect': 2,
    'love': 2, 'best': 2, 'brilliant': 2, 'outstanding': 2, 'incredible': 2,
    'great': 2, 'wonderful': 2, 'superb': 2, 'exceptional': 2
  };

  // Calculate base sentiment
  let sentimentScore = 0;
  let wordCount = 0;

  // First pass: count sentiment words
  words.forEach(word => {
    if (sentimentDict[word] !== undefined) {
      sentimentScore += sentimentDict[word];
      wordCount++;
    }
  });

  // Look for negations that flip sentiment
  const negations = ['not', 'no', 'never', 'dont', 'doesnt', 'isnt', 'cant', 'wont'];
  for (let i = 0; i < words.length - 1; i++) {
    if (negations.includes(words[i])) {
      const nextWord = words[i + 1];
      if (sentimentDict[nextWord]) {
        // Flip and dampen the sentiment
        sentimentScore -= 2 * sentimentDict[nextWord];
      }
    }
  }

  // If we found sentiment words, normalize by word count
  if (wordCount > 0) {
    sentimentScore = sentimentScore / Math.sqrt(wordCount);
  }

  // Add karma influence (weighted more for controversial topics)
  if (score) {
    const karmaInfluence = Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.15;
    sentimentScore += karmaInfluence;
  }

  // Add comment count influence (high comments often mean controversy)
  if (numComments > 100) {
    const commentInfluence = -0.1; // High comment counts slightly bias towards negative
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

  // Classify with balanced thresholds (make it easier to be negative)
  if (sentimentScore > 0.4) return 'positive';
  if (sentimentScore < -0.2) return 'negative';
  return 'neutral';
}
