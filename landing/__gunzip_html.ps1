[IO.Compression.GZipStream]::new([IO.File]::OpenRead('landing\__clean.html.gz'),[IO.Compression.CompressionMode]::Decompress).CopyTo([IO.File]::Create('landing\order-current-flow-mock.html'))
