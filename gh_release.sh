# Change directory to the script's directory
cd "$(dirname $0)" 

# Get version from theme.json
version=v$(grep -oP '(?<="version": ")[^"]+' plugin.json) 


pnpm run build
gh release create $version package.zip --title "$version / $(date +%Y-%m-%d)" 
--target main --repo Achuan-2/siyuan-plugin-task-note-management