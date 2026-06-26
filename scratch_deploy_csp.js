import { execSync } from 'child_process';

try {
  console.log('Staging files...');
  execSync('git add .', { stdio: 'inherit' });
  
  console.log('Committing changes...');
  execSync('git commit -m "chore: secure helmet CSP for Firebase Mapbox and Cloudinary"', { stdio: 'inherit' });
  
  console.log('Pushing to GitHub...');
  execSync('git push origin main', { stdio: 'inherit' });
  
  console.log('Success! Git push completed successfully.');
} catch (err) {
  console.error('Git execution failed:', err.message);
  process.exit(1);
}
