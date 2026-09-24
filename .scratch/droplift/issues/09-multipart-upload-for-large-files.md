# 09: Multipart upload for large files

**What to build:** Files of 16 MiB and more upload as multipart with the S3 transfer manager. Part size is `max(8 MiB, ceil(size / 10000))`, and every Part except the last has the same size (R2 rule). The Queue runs at most 3 files at the same time and at most 4 Parts per file. Each Part is recorded in SQLite (PRD U1, U2, U4, §8 Throughput/Memory).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] Files below 16 MiB use a single PUT; files of 16 MiB and more use multipart
- [ ] Part size follows the formula; all Parts except the last are the same size
- [ ] R2 accepts the upload (checksum mode `WHEN_REQUIRED` if R2 refuses the SDK default)
- [ ] Max 3 files and 4 Parts per file at the same time (configurable)
- [ ] Each Part row records size, start, end, retries, and speed
- [ ] 1 GB file: speed is at least 90% of `aws s3 cp` on the same network (measured)
- [ ] Host + Engine stay below 150 MB RSS during 10 parallel Uploads
