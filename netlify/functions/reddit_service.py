from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs
import json
from praw import Reddit
import os
from textblob import TextBlob
from collections import defaultdict

# Initialize Reddit client
reddit = Reddit(
    client_id=os.getenv('REDDIT_CLIENT_ID'),
    client_secret=os.getenv('REDDIT_CLIENT_SECRET'),
    user_agent='SentimentAnalyzer/1.0'
)

def analyze_sentiment(text: str) -> str:
    analysis = TextBlob(text)
    if analysis.sentiment.polarity > 0:
        return "positive"
    elif analysis.sentiment.polarity < 0:
        return "negative"
    else:
        return "neutral"

def handler(event, context):
    # Extract query parameter from path
    path_parts = event['path'].split('/')
    if len(path_parts) < 2:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'No search query provided'})
        }
    
    query = path_parts[-1]
    
    try:
        # Search Reddit
        submissions = reddit.subreddit('all').search(query, limit=100)
        
        posts = []
        sentiment_counts = {"positive": 0, "negative": 0, "neutral": 0}
        subreddit_sentiment = defaultdict(lambda: {"positive": 0, "negative": 0, "neutral": 0})
        
        for submission in submissions:
            try:
                text_content = f"{submission.title} {submission.selftext if hasattr(submission, 'selftext') else ''}"
                sentiment = analyze_sentiment(text_content)
                
                sentiment_counts[sentiment] += 1
                subreddit_sentiment[submission.subreddit.display_name][sentiment] += 1
                
                posts.append({
                    "id": submission.id,
                    "title": submission.title,
                    "url": submission.url,
                    "score": submission.score,
                    "num_comments": submission.num_comments,
                    "created_utc": submission.created_utc,
                    "subreddit": submission.subreddit.display_name,
                    "sentiment": sentiment
                })
            except Exception as post_error:
                continue
        
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            'body': json.dumps({
                "posts": posts,
                "overall_sentiment": sentiment_counts,
                "total_posts": len(posts),
                "subreddit_sentiment": dict(subreddit_sentiment)
            })
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
