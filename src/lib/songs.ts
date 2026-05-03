export interface Song {
  title: string;
  artist: string;
  year: number;
  uri: string; // spotify track URI
}

// 20 temazos de varias décadas con año original de lanzamiento
export const SONGS: Song[] = [
  { title: "Bohemian Rhapsody", artist: "Queen", year: 1975, uri: "spotify:track:7tFiyTwD0nx5a1eklYtX2J" },
  { title: "Billie Jean", artist: "Michael Jackson", year: 1982, uri: "spotify:track:5ChkMS8OtdzJeqyybCc9R5" },
  { title: "Like a Prayer", artist: "Madonna", year: 1989, uri: "spotify:track:1z3ugFmUKoCzGsI6jdY4Ci" },
  { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991, uri: "spotify:track:5ghIJDpPoe3CfHMGu71E6T" },
  { title: "Wonderwall", artist: "Oasis", year: 1995, uri: "spotify:track:5wj4WlGFqx0RDFPOzAnPvk" },
  { title: "...Baby One More Time", artist: "Britney Spears", year: 1998, uri: "spotify:track:3MjUtNVVq3C8Fn0MP3zhXa" },
  { title: "In Da Club", artist: "50 Cent", year: 2003, uri: "spotify:track:7iL6o9tox1zgHpKUfh9vuC" },
  { title: "Crazy in Love", artist: "Beyoncé", year: 2003, uri: "spotify:track:5IVuqXILoxVWvWEPm82Jxr" },
  { title: "Mr. Brightside", artist: "The Killers", year: 2003, uri: "spotify:track:003vvx7Niy0yvhvHt4a68B" },
  { title: "Umbrella", artist: "Rihanna", year: 2007, uri: "spotify:track:49FYlytm3dAAraYgpoJZux" },
  { title: "Poker Face", artist: "Lady Gaga", year: 2008, uri: "spotify:track:0WqIKmW4BTrj3eJFmnCKMv" },
  { title: "Rolling in the Deep", artist: "Adele", year: 2010, uri: "spotify:track:4umIPjkehX1r7uhmGvXiSV" },
  { title: "Somebody That I Used to Know", artist: "Gotye", year: 2011, uri: "spotify:track:4wCmqSrbyCgxEXROQE6vtV" },
  { title: "Get Lucky", artist: "Daft Punk", year: 2013, uri: "spotify:track:69kOkLUCkxIZYexIgSG8rq" },
  { title: "Happy", artist: "Pharrell Williams", year: 2013, uri: "spotify:track:60nZcImufyMA1MKQY3dcCH" },
  { title: "Uptown Funk", artist: "Mark Ronson", year: 2014, uri: "spotify:track:32OlwWuMpZ6b0aN2RZOeMS" },
  { title: "Despacito", artist: "Luis Fonsi", year: 2017, uri: "spotify:track:6habFhsOp2NvshLv26DqMb" },
  { title: "Shape of You", artist: "Ed Sheeran", year: 2017, uri: "spotify:track:7qiZfU4dY1lWllzX7mPBI3" },
  { title: "Blinding Lights", artist: "The Weeknd", year: 2019, uri: "spotify:track:0VjIjW4GlUZAMYd2vXMi3b" },
  { title: "As It Was", artist: "Harry Styles", year: 2022, uri: "spotify:track:4Dvkj6JhhA12EX05fT7y2e" },
];
