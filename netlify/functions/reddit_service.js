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
      sentiment: analyzeSentiment(child.data.title + ' ' + (child.data.selftext || ''))
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

// Simple sentiment analysis function
function analyzeSentiment(text) {
  const positiveWords = [
    'good', 'great', 'awesome', 'excellent', 'happy', 'love', 'wonderful', 'fantastic',
    'best', 'amazing', 'brilliant', 'perfect', 'better', 'beautiful', 'win', 'winning',
    'success', 'successful', 'impressive', 'innovative', 'improvement', 'improved',
    'helpful', 'positive', 'interesting', 'excited', 'exciting', 'nice', 'cool',
    'recommend', 'recommended', 'works', 'working', 'well', 'solved', 'solution',
    'support', 'supported', 'like', 'good', 'great', 'love', 'awesome', 'nice', 'amazing'
  ];

  const negativeWords = [
    'bad', 'terrible', 'awful', 'horrible', 'sad', 'hate', 'poor', 'disaster',
    'worst', 'broken', 'bug', 'issue', 'problem', 'fail', 'failed', 'failing',
    'disappointed', 'disappointing', 'useless', 'waste', 'difficult', 'hard',
    'impossible', 'angry', 'mad', 'frustrated', 'frustrating', 'annoying',
    'annoyed', 'slow', 'expensive', 'costly', 'cost', 'negative', 'wrong',
    'error', 'errors', 'crash', 'crashes', 'crashed', 'bug', 'bugs', 'broken',
    'unusable', 'confusing', 'confused', 'problem', 'problems', 'issue', 'issues'
  ];
  
  text = text.toLowerCase();
  const words = text.split(/\s+/);
  
  // Count word occurrences for more accurate scoring
  let positiveScore = 0;
  let negativeScore = 0;
  
  words.forEach(word => {
    if (positiveWords.includes(word)) positiveScore++;
    if (negativeWords.includes(word)) negativeScore++;
  });

  // Add weight based on certain phrases
  const phrases = {
    positive: ['highly recommend', 'really good', 'very good', 'works great', 'much better', 'really like'],
    negative: ['dont recommend', 'doesnt work', 'not working', 'waste of', 'too expensive', 'very bad']
  };

  phrases.positive.forEach(phrase => {
    if (text.includes(phrase)) positiveScore += 2;
  });

  phrases.negative.forEach(phrase => {
    if (text.includes(phrase)) negativeScore += 2;
  });

  // Consider text length in scoring
  const threshold = Math.max(1, Math.floor(words.length / 50)); // Adjust threshold based on text length
  
  if (positiveScore > negativeScore && positiveScore >= threshold) return 'positive';
  if (negativeScore > positiveScore && negativeScore >= threshold) return 'negative';
  if (positiveScore === negativeScore && positiveScore >= threshold) return 'positive';
  if (positiveScore === negativeScore && positiveScore > 0) return 'neutral';
  if (positiveScore === 0 && negativeScore === 0) return 'neutral';
  return positiveScore > negativeScore ? 'positive' : 'negative';
}
