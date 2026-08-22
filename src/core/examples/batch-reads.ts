// description: "Batch reads — sign many hidden files, list versions and metadata for many files, and resolve many folders in one request each."
import { config } from 'dotenv';
import { resolve } from 'path';
import { EngineServicesClient } from '../client';

config({ path: resolve(__dirname, '.env') });

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_URL = process.env.API_URL;
const PROJECT_ID = process.env.PROJECT_ID;

if (!ACCESS_TOKEN || !API_URL) {
  throw new Error('ACCESS_TOKEN and API_URL are required in src/core/examples/.env');
}

async function main() {
  const client = new EngineServicesClient(ACCESS_TOKEN!, API_URL!);

  if (!PROJECT_ID) {
    console.log('Set PROJECT_ID in .env to run this example.');
    return;
  }

  const files = await client.listFiles({ projectId: PROJECT_ID });
  if (!files.length) {
    console.log('No files in this project — nothing to batch.');
    return;
  }
  const fileIds = files.map((file) => String(file._id));

  // --- Versions for a whole page of files ---
  // One request instead of one per file. Entries come back in request order,
  // and a file the token cannot read carries an `error` instead of `versions`.
  const versionEntries = await client.listVersionsBatch(fileIds);
  console.log('\nVersions per file:');
  for (const entry of versionEntries) {
    if (entry.error) {
      console.log(`  ${entry.itemId} → ${entry.error.status} ${entry.error.message}`);
      continue;
    }
    console.log(`  ${entry.itemId} → ${entry.versions?.length ?? 0} version(s)`);
  }

  // --- Metadata for specific (file, version) pairs ---
  // The versions above already carry their metadata, so this is only needed
  // when the version list itself is not wanted.
  const pairs = versionEntries
    .filter((entry) => entry.versions?.length)
    .map((entry) => ({
      itemId: entry.itemId,
      versionTag: entry.versions![0].tag,
    }));
  const metadataEntries = await client.getFileVersionMetadataBatch(pairs);
  console.log('\nLatest-version metadata:');
  for (const entry of metadataEntries) {
    console.log(
      `  ${entry.itemId}@${entry.versionTag} → ${JSON.stringify(entry.metadata ?? entry.error)}`,
    );
  }

  // --- Folders by id ---
  // Use listFolders({ projectId }) for the whole tree; this is for a known set
  // of ids, such as the parents behind a breadcrumb.
  const folderIds = [
    ...new Set(files.map((file) => file.folderId).filter(Boolean).map(String)),
  ];
  if (folderIds.length) {
    const folderEntries = await client.getFoldersBatch(folderIds);
    console.log('\nFolders:');
    for (const entry of folderEntries) {
      console.log(`  ${entry.folderId} → ${entry.folder?.name ?? entry.error?.message}`);
    }
  }

  // --- Signed URLs for many hidden files ---
  // This is the call tile-based viewers (splats, point clouds) should use.
  // Minting one URL per tile as the camera moves is what pushes a single
  // session past the rate limit; one request covers up to 100 tiles, and
  // longer lists are split into several requests automatically.
  const hiddenFiles = await client.getHiddenFilesByParent(fileIds[0]);
  if (!hiddenFiles.length) {
    console.log('\nNo hidden files on the first file — skipping signed URLs.');
    return;
  }
  const signedEntries = await client.getHiddenFileSignedUrlsBatch(
    hiddenFiles.map((hiddenFile) => String(hiddenFile._id)),
    3600,
  );
  console.log('\nSigned hidden file URLs:');
  for (const entry of signedEntries) {
    if (entry.error) {
      console.log(`  ${entry.hiddenFileId} → ${entry.error.status} ${entry.error.message}`);
      continue;
    }
    console.log(`  ${entry.hiddenFileId} → expires ${entry.expiresAt}`);
  }
}

main().catch(console.error);
