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
  
  // First check for strong opinion patterns
  const strongPatterns = {
    negative: [
      'dont install', 'do not install', 'stay away', 'avoid',
      'waste of', 'not worth', 'terrible', 'horrible',
      'scam', 'fraud', 'fake', 'malware', 'virus',
      'doesnt work', 'doesn\'t work', 'not working',
      'garbage', 'useless', 'awful', 'worst'
    ],
    positive: [
      'highly recommend', 'great product', 'works perfectly',
      'very good', 'excellent', 'amazing', 'fantastic',
      'worth every', 'best', 'love it', 'awesome'
    ]
  };

  // Check strong patterns first
  for (const pattern of strongPatterns.negative) {
    if (text.includes(pattern)) {
      return 'negative';
    }
  }
  
  for (const pattern of strongPatterns.positive) {
    if (text.includes(pattern)) {
      return 'positive';
    }
  }

  // Neutral patterns (questions, comparisons, general discussion)
  const neutralPatterns = [
    'how to', 'how do', 'what is', 'which is',
    'anyone use', 'anyone tried', 'anyone using',
    'vs', 'versus', 'compared to', 'difference between',
    'thoughts on', 'opinion on', 'review of',
    'help with', 'question about', 'looking for'
  ];

  for (const pattern of neutralPatterns) {
    if (text.includes(pattern)) {
      // Check if there's strong sentiment despite being a question
      const sentimentScore = calculateSentimentScore(text, words);
      if (Math.abs(sentimentScore) > 1.5) {
        return sentimentScore > 0 ? 'positive' : 'negative';
      }
      return 'neutral';
    }
  }

  // Calculate base sentiment score
  let finalScore = calculateSentimentScore(text, words);

  // Add karma influence
  if (score) {
    const karmaInfluence = Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.1;
    finalScore += karmaInfluence;
  }

  // Add comment count influence (high comments often indicate controversy)
  if (numComments > 50) {
    finalScore -= 0.1; // Slight negative bias for controversial topics
  }

  // Time decay (newer posts weighted slightly more)
  if (created) {
    const ageInDays = (Date.now() - new Date(created * 1000).getTime()) / (1000 * 60 * 60 * 24);
    finalScore *= (1 / (1 + ageInDays * 0.01));
  }

  // Classify with balanced thresholds
  if (finalScore > 0.5) return 'positive';
  if (finalScore < -0.3) return 'negative';
  return 'neutral';
}

function calculateSentimentScore(text, words) {
  const sentimentDict = {
    // Strong negative terms (-2)
    'terrible': -2, 'horrible': -2, 'awful': -2, 'worst': -2,
    'scam': -2, 'fraud': -2, 'fake': -2, 'malware': -2,
    'virus': -2, 'spyware': -2, 'garbage': -2, 'useless': -2,
    'broken': -2, 'unusable': -2, 'avoid': -2, 'dangerous': -2,
    'infected': -2, 'suspicious': -2, 'bloatware': -2,
    
    // Moderate negative terms (-1)
    'bad': -1, 'poor': -1, 'slow': -1, 'issue': -1,
    'problem': -1, 'bug': -1, 'glitch': -1, 'error': -1,
    'crash': -1, 'crashes': -1, 'annoying': -1, 'frustrating': -1,
    'expensive': -1, 'pricey': -1, 'difficult': -1, 'complicated': -1,
    'unstable': -1, 'unreliable': -1, 'mediocre': -1,
    
    // Slightly negative terms (-0.5)
    'not': -0.5, 'cant': -0.5, 'cant': -0.5, 'wont': -0.5,
    'doesnt': -0.5, 'isnt': -0.5, 'no': -0.5, 'never': -0.5,
    
    // Slightly positive terms (0.5)
    'ok': 0.5, 'okay': 0.5, 'fine': 0.5, 'decent': 0.5,
    'works': 0.5, 'working': 0.5, 'stable': 0.5,
    
    // Moderate positive terms (1)
    'good': 1, 'nice': 1, 'helpful': 1, 'useful': 1,
    'clean': 1, 'fast': 1, 'smooth': 1, 'reliable': 1,
    'worth': 1, 'recommended': 1, 'secure': 1, 'safe': 1,
    'effective': 1, 'efficient': 1, 'impressive': 1,
    
    // Strong positive terms (2)
    'excellent': 2, 'amazing': 2, 'awesome': 2, 'fantastic': 2,
    'perfect': 2, 'best': 2, 'love': 2, 'great': 2,
    'outstanding': 2, 'superb': 2, 'brilliant': 2, 'wonderful': 2
  };

  let score = 0;
  let wordCount = 0;
  let hasNegation = false;

  // First pass: check for negations
  for (let i = 0; i < words.length; i++) {
    if (['not', 'no', 'never', 'dont', 'doesnt', 'isnt', 'cant', 'wont'].includes(words[i])) {
      hasNegation = true;
    } else if (sentimentDict[words[i]] !== undefined) {
      if (hasNegation) {
        score -= sentimentDict[words[i]] * 1.5; // Negated terms count more
        hasNegation = false;
      } else {
        score += sentimentDict[words[i]];
      }
      wordCount++;
    } else {
      hasNegation = false;
    }
  }

  // Normalize score but maintain impact of multiple sentiments
  return wordCount > 0 ? score / Math.sqrt(wordCount) : 0;
}
